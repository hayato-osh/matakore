import type { RecordRow, RecordStore } from './records'
import { SYNC_PAGE, SYNC_TABLES, type SyncChange, type SyncRequest, type SyncResponse, type SyncTable } from './types'

// 差分同期（§6.2）。1往復で「未送信の変更を受け取る → cursor より後の変更を返す」の両方をやる。
// 判定パスには一切関わらない。クライアントは圏外でも・この Worker が落ちていても動き、
// ここは「機種変更で消えない」ためだけにある。

/** Access の JWT から同期の主体を決める。ローカル開発（DEV_NO_AUTH）だけ固定の 'dev'。 */
export const userIdOf = (claims: { email?: string; sub?: string } | undefined, devBypass: boolean) =>
  claims?.email || claims?.sub || (devBypass ? 'dev' : undefined)

const isTable = (v: unknown): v is SyncTable => typeof v === 'string' && (SYNC_TABLES as readonly string[]).includes(v)
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** 型の合わないものは 400 に倒す。D1 に変なものを書いてから困るより、入口で止める。 */
export const parseSyncRequest = (body: unknown): SyncRequest | null => {
  if (!isRecord(body)) return null
  const { cursor, changes } = body
  if (typeof cursor !== 'number' || !Number.isInteger(cursor) || cursor < 0) return null
  if (!Array.isArray(changes) || changes.length > SYNC_PAGE) return null
  const out: SyncChange[] = []
  for (const c of changes) {
    if (!isRecord(c)) return null
    if (!isTable(c.tbl)) return null
    if (typeof c.key !== 'string' || c.key.length === 0 || c.key.length > 200) return null
    if (!(c.data === null || isRecord(c.data))) return null
    if (typeof c.at !== 'number' || !Number.isFinite(c.at)) return null
    out.push({ tbl: c.tbl, key: c.key, data: c.data, at: c.at })
  }
  return { cursor, changes: out }
}

const rowToChange = (r: RecordRow): SyncChange => ({
  tbl: r.tbl,
  key: r.key,
  data: r.data === null ? null : (JSON.parse(r.data) as Record<string, unknown>),
  at: r.updated_at,
})

export const runSync = async (
  store: RecordStore,
  user: string,
  req: SyncRequest,
  now = Date.now(),
): Promise<SyncResponse> => {
  // 端末の時計が進んでいても未来の時刻は受け付けない。一度でも通すと、その行は他の端末から永遠に上書きできなくなる
  const changes = req.changes.map((c) => (c.at > now ? { ...c, at: now } : c))
  if (changes.length) await store.upsert(user, changes)

  const rows = await store.since(user, req.cursor, SYNC_PAGE + 1)
  const more = rows.length > SYNC_PAGE
  const page = more ? rows.slice(0, SYNC_PAGE) : rows
  const cursor = page.length ? page[page.length - 1].seq : req.cursor

  // 今受け取った変更がそのまま勝った行は送り返さない（クライアントはもう持っている）。
  // 負けた行（別の端末の方が新しかった）はここで返し、クライアント側を上書きさせる。
  const pushed = new Map(changes.map((c) => [`${c.tbl}/${c.key}`, c.at]))
  const out = page.filter((r) => pushed.get(`${r.tbl}/${r.key}`) !== r.updated_at).map(rowToChange)
  return { cursor, changes: out, more }
}

/** アプリのエクスポート（src/db/export.ts の Backup）と同じ形。アプリの「読み込む」にそのまま渡せる。 */
export const buildBackup = async (store: RecordStore, user: string, now = Date.now()) => {
  const rows = await store.all(user)
  const out: Record<SyncTable, Record<string, unknown>[]> = { products: [], purchases: [], reviews: [], categories: [] }
  for (const r of rows) if (r.data !== null) out[r.tbl].push(JSON.parse(r.data) as Record<string, unknown>)
  return { app: 'matakore' as const, version: 1, exportedAt: now, ...out }
}

/**
 * サーバーの控えを全部消す。行を物理削除せず墓標にする。
 * 消してしまうと seq が 1 から振り直され、古い cursor を持つ別の端末が新しい行を取りこぼす。
 */
export const wipeRecords = async (store: RecordStore, user: string, now = Date.now()) => {
  const rows = await store.all(user)
  const live = rows.filter((r) => r.data !== null)
  await store.upsert(
    user,
    live.map((r) => ({ tbl: r.tbl, key: r.key, data: null, at: now })),
  )
  return live.length
}
