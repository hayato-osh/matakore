import { db, onDirty, syncTable } from '../db/db'
import { silently, SYNC_TABLES, type Outbox, type SyncTable } from '../db/outbox'
import { primaryKeyOf, sanitizeRow } from '../db/validate'
import { apiFetch, errorOf, isOfflineError } from './api'

// 差分同期（§6.2、Phase 2）。記録の控えを同一オリジンの Worker 経由で D1 に置き、機種変更で消えないようにする。
// 判定パスには一切関わらない。ここは裏で勝手に走り、失敗しても何も止めない（店内は圏外が普通）。
// サーバー側 server/sync.ts と契約（SyncChange / SyncRequest / SyncResponse）を手で対にしている。

export type SyncChange = { tbl: SyncTable; key: string; data: Record<string, unknown> | null; at: number }
type SyncRequest = { cursor: number; changes: SyncChange[] }
type SyncResponse = { cursor: number; changes: SyncChange[]; more: boolean }

/** 1往復で運ぶ上限。サーバー側と同じ値 */
export const SYNC_PAGE = 500
/** 500件の JSON を電波の弱い場所で送ることもあるので、JAN 解決より長めに待つ */
export const SYNC_TIMEOUT_MS = 20_000

export type SyncOutcome = 'synced' | 'offline' | 'login' | 'error'

class LoginRequired extends Error {}

const keyOf = (c: { tbl: SyncTable; key: string }) => `${c.tbl}/${c.key}`
const allTables = () => SYNC_TABLES.map((t) => db[t])

const post = async (req: SyncRequest, fetchImpl: typeof fetch): Promise<SyncResponse> => {
  const r = await apiFetch(
    '/sync',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
      timeoutMs: SYNC_TIMEOUT_MS,
    },
    fetchImpl,
  )
  if (r.login) throw new LoginRequired()
  if (r.status !== 200) throw new Error(errorOf(r.body, r.status))
  return r.body as SyncResponse
}

/** 未送信の行を、今の中身つきで組み立てる。行が無ければ削除として送る。 */
const buildChanges = (dirty: Outbox[]) =>
  db.transaction('r', allTables(), () =>
    Promise.all(
      dirty.map(async (d): Promise<SyncChange> => ({
        tbl: d.tbl,
        key: d.key,
        data: (await syncTable(d.tbl).get(d.key)) ?? null,
        at: d.at,
      })),
    ),
  )

/**
 * サーバーから受け取った変更をローカルに書く。outbox には積まない（silently）。
 * 送信中にこの端末で触った行（outbox に残っている行）は上書きしない。次の同期でこちらの方が新しいとして送る。
 * 初回（initial）だけは未送信の行も新旧で決める。サーバーの方が新しければ受け入れて未送信から下ろし、
 * こちらの方が新しければ（同時刻を含む）残して次に送る。初回で受け取った行は cursor より前になるので、
 * ここで決めておかないと、後で送って負けた行のサーバー版が二度と降ってこない。
 * 形の壊れた行は飛ばす。1行のために止まると cursor が進まず、毎回同じ行で失敗し続ける。
 */
const applyRemote = (changes: SyncChange[], initial: boolean) =>
  db.transaction('rw', [...allTables(), db.outbox], async (tx) => {
    silently(tx)
    const pending = new Map((await db.outbox.toArray()).map((o) => [keyOf(o), o.at]))
    let skipped = 0
    for (const c of changes) {
      const mine = pending.get(keyOf(c))
      if (mine !== undefined) {
        if (!initial || c.at <= mine) continue
        await db.outbox.delete([c.tbl, c.key])
      }
      const table = syncTable(c.tbl)
      if (c.data === null) {
        await table.delete(c.key)
        continue
      }
      const row = sanitizeRow(c.tbl, c.data)
      if (!row || primaryKeyOf(c.tbl, row) !== c.key) {
        skipped++
        continue
      }
      await table.put(row)
    }
    if (skipped) console.warn(JSON.stringify({ event: 'sync_skipped_rows', skipped }))
  })

/** 送り終えた分を outbox から下ろす。送信中にまた触られた行（at が進んでいる）は残す。 */
const settle = (sent: Outbox[]) =>
  db.transaction('rw', db.outbox, async () => {
    for (const s of sent) {
      const cur = await db.outbox.get([s.tbl, s.key])
      if (cur && cur.at === s.at) await db.outbox.delete([s.tbl, s.key])
    }
  })

/**
 * 初回接続。サーバーの控えを全部受け取ってから、サーバーが知らない行だけを未送信に積む。
 * - 使い込んだ端末が初めて同期する（サーバーは空）→ 全部送る
 * - 機種変更した新しい端末（ローカルはシードだけ）→ 全部受け取る。シードのうちサーバーに無いものだけ送る
 * サーバーが知っていて、こちらに未送信の無い行はサーバーが勝つ（シードは未送信に積まないので、
 * 古い端末で消したカテゴリを新しい端末のシードが蘇らせない）。未送信のある行は applyRemote が新旧で決め、
 * 残った未送信はそのまま次に送る（控えごと消した後の再シードはこの経路で墓標に勝つ）。
 */
const initialPull = async (fetchImpl: typeof fetch) => {
  let cursor = 0
  const known = new Set<string>()
  for (;;) {
    const res = await post({ cursor, changes: [] }, fetchImpl)
    await applyRemote(res.changes, true)
    for (const c of res.changes) known.add(keyOf(c))
    cursor = res.cursor
    if (!res.more) break
  }
  await db.transaction('rw', [...allTables(), db.outbox, db.meta], async () => {
    const at = Date.now()
    for (const tbl of SYNC_TABLES) {
      for (const key of await syncTable(tbl).toCollection().primaryKeys()) {
        if (!known.has(`${tbl}/${key}`) && !(await db.outbox.get([tbl, key]))) await db.outbox.put({ tbl, key, at })
      }
    }
    await db.meta.put({ key: 'sync', cursor })
  })
  return cursor
}

/** 結果を設定画面に残す。初回接続の前（cursor 無し）でも残し、cursor は触らない */
const noteError = async (error: string) => {
  const meta = await db.meta.get('sync')
  await db.meta.put({ ...meta, key: 'sync', error })
}

const run = async (fetchImpl: typeof fetch): Promise<SyncOutcome> => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline'
  try {
    const meta = await db.meta.get('sync')
    let cursor = meta?.cursor ?? (await initialPull(fetchImpl))
    for (;;) {
      const dirty = (await db.outbox.toArray()).slice(0, SYNC_PAGE)
      const res = await post({ cursor, changes: await buildChanges(dirty) }, fetchImpl)
      await settle(dirty)
      await applyRemote(res.changes, false)
      cursor = res.cursor
      await db.meta.put({ key: 'sync', cursor, syncedAt: Date.now() })
      if (dirty.length < SYNC_PAGE && !res.more) return 'synced'
    }
  } catch (e) {
    if (e instanceof LoginRequired) {
      await noteError('ログインが切れています')
      return 'login'
    }
    // 圏外は正常系。前回の結果を汚さない
    if (isOfflineError(e)) return 'offline'
    await noteError(e instanceof Error ? e.message : String(e))
    return 'error'
  }
}

let running: Promise<SyncOutcome> | null = null
let again = false
let timer: ReturnType<typeof setTimeout> | undefined

/** 今すぐ同期する。走っている最中に呼ばれたら、終わってからもう一度回す。 */
export const syncNow = (fetchImpl: typeof fetch = fetch): Promise<SyncOutcome> => {
  if (running) {
    again = true
    return running
  }
  running = run(fetchImpl).finally(() => {
    running = null
    if (again) {
      again = false
      scheduleSync(0)
    }
  })
  return running
}

/** 少し待ってから同期する。連続した書き込み（登録 → 購入）を1往復にまとめるため。 */
export const scheduleSync = (delayMs = 2000) => {
  clearTimeout(timer)
  timer = setTimeout(() => void syncNow(), delayMs)
}

/**
 * 起動時に一度、以後は「書き込みの少し後」「復帰したとき」「電波が戻ったとき」に裏で同期する。
 * 判定の途中で走っても構わない（ローカルの読み取りを止めない）。
 */
export const startSync = () => {
  onDirty(() => scheduleSync())
  window.addEventListener('online', () => scheduleSync(1000))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync(500)
  })
  void syncNow()
}

/** 設定画面の「サーバーの控えも含めて削除」。成功したらローカルも消す（呼び出し側）。 */
export const wipeRemote = async (fetchImpl: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; message: string }> => {
  try {
    const r = await apiFetch('/sync', { method: 'DELETE', timeoutMs: SYNC_TIMEOUT_MS }, fetchImpl)
    if (r.login) return { ok: false, message: 'ログインが切れています' }
    if (r.status !== 200) return { ok: false, message: errorOf(r.body, r.status) }
    return { ok: true }
  } catch (e) {
    return { ok: false, message: isOfflineError(e) ? '圏外のため消せません' : e instanceof Error ? e.message : String(e) }
  }
}
