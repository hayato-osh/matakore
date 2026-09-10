import 'fake-indexeddb/auto'
import { beforeEach, expect, test } from 'vitest'
import { syncNow, wipeRemote, type SyncChange } from '../../lib/sync'
import { db, ensureSeeded, reseedForSync } from '../db'
import { importBackup, wipeAll } from '../export'
import { deleteProductCascade, recordPurchase, saveReview, upsertProduct } from '../repo'

const CURRY = '食品/カレー・ハヤシ'
const KOKUMARO = '4902102072618'

// server/sync.ts と同じ意味論の相手役。in-memory で seq と新旧比較だけを再現する。
const fakeServer = () => {
  type Row = { tbl: string; key: string; data: Record<string, unknown> | null; at: number; seq: number }
  const rows = new Map<string, Row>()
  let seq = 0
  const calls: { cursor: number; changes: SyncChange[] }[] = []
  const put = (c: Omit<Row, 'seq'>) => {
    const id = `${c.tbl}/${c.key}`
    const cur = rows.get(id)
    if (cur && c.at < cur.at) return
    rows.set(id, { ...c, seq: ++seq })
  }
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) !== '/api/sync') return new Response('{}', { status: 404 })
    if (init?.method === 'DELETE') {
      // server/sync.ts の wipeRecords と同じ。生きている行を全部墓標にする
      const now = Date.now()
      for (const r of [...rows.values()]) if (r.data !== null) put({ tbl: r.tbl, key: r.key, data: null, at: now })
      return new Response('{"ok":true,"deleted":0}')
    }
    if (init?.method !== 'POST') return new Response('{}', { status: 404 })
    const req = JSON.parse(String(init.body)) as { cursor: number; changes: SyncChange[] }
    calls.push(req)
    for (const c of req.changes) put(c)
    const page = [...rows.values()].filter((r) => r.seq > req.cursor).sort((a, b) => a.seq - b.seq)
    const pushed = new Map(req.changes.map((c) => [`${c.tbl}/${c.key}`, c.at]))
    const changes = page.filter((r) => pushed.get(`${r.tbl}/${r.key}`) !== r.at).map((r) => ({ tbl: r.tbl, key: r.key, data: r.data, at: r.at }))
    return new Response(JSON.stringify({ cursor: page.length ? page[page.length - 1].seq : req.cursor, changes, more: false }))
  }) as typeof fetch
  return { rows, calls, put, fetchImpl, get: (tbl: string, key: string) => rows.get(`${tbl}/${key}`) }
}

const fresh = async () => {
  if (db.isOpen()) db.close()
  await db.delete()
  await db.open()
  await ensureSeeded()
}

beforeEach(fresh)

test('書き込みは outbox に積まれ、同じ行は1件にまとまる。シードは積まない', async () => {
  expect(await db.outbox.count()).toBe(0)
  await upsertProduct({ jan: KOKUMARO, name: 'こくまろ', categoryId: CURRY })
  await upsertProduct({ jan: KOKUMARO, name: 'こくまろカレー', categoryId: CURRY })
  const p = await recordPurchase(KOKUMARO)
  await saveReview(KOKUMARO, { intent: 'yes', tags: [] })
  await db.categories.put({ id: '食品/新しい', major: '食品', minor: '新しい' })
  const keys = (await db.outbox.toArray()).map((o) => `${o.tbl}/${o.key}`).sort()
  expect(keys).toEqual([`categories/食品/新しい`, `products/${KOKUMARO}`, `purchases/${p.id}`, `reviews/${KOKUMARO}`].sort())
})

test('削除も（where().delete() 経由でも）outbox に残り、削除として送られる', async () => {
  const server = fakeServer()
  await upsertProduct({ jan: KOKUMARO, name: 'こくまろ', categoryId: CURRY })
  const p = await recordPurchase(KOKUMARO)
  await saveReview(KOKUMARO, { intent: 'yes', tags: [] })
  expect(await syncNow(server.fetchImpl)).toBe('synced')
  expect(await db.outbox.count()).toBe(0)

  await deleteProductCascade(KOKUMARO)
  expect(await syncNow(server.fetchImpl)).toBe('synced')
  expect(server.get('products', KOKUMARO)?.data).toBeNull()
  expect(server.get('purchases', p.id)?.data).toBeNull()
  expect(server.get('reviews', KOKUMARO)?.data).toBeNull()
})

test('使い込んだ端末の初回同期はローカルを全部送る（シード済みカテゴリも）', async () => {
  const server = fakeServer()
  await upsertProduct({ jan: KOKUMARO, name: 'こくまろ', categoryId: CURRY })
  await saveReview(KOKUMARO, { intent: 'staple', memo: '常備', tags: ['常備'] })
  expect(await syncNow(server.fetchImpl)).toBe('synced')
  expect(server.get('reviews', KOKUMARO)?.data).toMatchObject({ intent: 'staple', memo: '常備' })
  expect(server.get('categories', CURRY)?.data).toMatchObject({ minor: 'カレー・ハヤシ' })
  expect(await db.outbox.count()).toBe(0)
  expect((await db.meta.get('sync'))?.syncedAt).toBeTypeOf('number')
})

test('端末を消して同期し直すと控えが戻る（機種変更の経路）', async () => {
  const server = fakeServer()
  await upsertProduct({ jan: KOKUMARO, name: 'こくまろ', brand: 'ハウス食品', categoryId: CURRY })
  await recordPurchase(KOKUMARO, { price: 298 })
  await saveReview(KOKUMARO, { intent: 'yes', tags: [] })
  await syncNow(server.fetchImpl)

  await wipeAll()
  expect(await db.products.count()).toBe(0)
  expect(await db.meta.get('sync')).toBeUndefined()
  await ensureSeeded()

  expect(await syncNow(server.fetchImpl)).toBe('synced')
  expect((await db.products.get(KOKUMARO))?.brand).toBe('ハウス食品')
  expect(await db.purchases.where('jan').equals(KOKUMARO).count()).toBe(1)
  expect((await db.reviews.get(KOKUMARO))?.intent).toBe('yes')
  // 受け取った分は送り返さない
  expect(await db.outbox.count()).toBe(0)
})

test('新しい端末のシードは、古い端末で消したカテゴリを蘇らせない', async () => {
  const server = fakeServer()
  server.put({ tbl: 'categories', key: CURRY, data: null, at: 1 })
  server.put({ tbl: 'categories', key: '食品/直した', data: { id: '食品/直した', major: '食品', minor: '直した' }, at: 1 })
  expect(await db.categories.get(CURRY)).toBeDefined()
  expect(await syncNow(server.fetchImpl)).toBe('synced')
  expect(await db.categories.get(CURRY)).toBeUndefined()
  expect(await db.categories.get('食品/直した')).toBeDefined()
  // サーバーが知らないシードは送る。知っている（消した）ものは送り返さない
  expect(server.get('categories', CURRY)?.data).toBeNull()
  expect(server.get('categories', '食品/米・パン')?.data).toBeDefined()
})

test('使い込んだ端末の初回同期は、未送信の行を行ごとに新しい方で決める', async () => {
  const server = fakeServer()
  await upsertProduct({ jan: KOKUMARO, name: 'mine', categoryId: CURRY })
  const mineAt = (await db.outbox.get(['products', KOKUMARO]))!.at
  // 別の端末が後から直した商品と、先に直していたカテゴリ
  server.put({ tbl: 'products', key: KOKUMARO, data: { jan: KOKUMARO, name: 'server-newer', categoryId: CURRY, source: 'manual', fetchedAt: 1 }, at: mineAt + 1 })
  server.put({ tbl: 'categories', key: CURRY, data: { id: CURRY, major: '食品', minor: 'server-older' }, at: mineAt - 1 })
  await db.categories.put({ id: CURRY, major: '食品', minor: 'mine-newer' })

  expect(await syncNow(server.fetchImpl)).toBe('synced')
  expect((await db.products.get(KOKUMARO))?.name).toBe('server-newer')
  expect((await db.categories.get(CURRY))?.minor).toBe('mine-newer')
  expect(server.get('products', KOKUMARO)?.data).toMatchObject({ name: 'server-newer' })
  expect(server.get('categories', CURRY)?.data).toMatchObject({ minor: 'mine-newer' })
  expect(await db.outbox.count()).toBe(0)
})

test('控えごと消して開き直しても、再シードは墓標に消されず、他の端末にも戻る', async () => {
  const server = fakeServer()
  await upsertProduct({ jan: KOKUMARO, name: 'x', categoryId: CURRY })
  await syncNow(server.fetchImpl)

  // 設定画面の「サーバーの控えも含めて削除」と同じ手順。その後の location.reload() で ensureSeeded が走る
  expect(await wipeRemote(server.fetchImpl)).toEqual({ ok: true })
  await wipeAll()
  await reseedForSync()
  const seeded = await db.categories.count()
  await ensureSeeded()

  expect(await syncNow(server.fetchImpl)).toBe('synced')
  expect(await db.categories.count()).toBe(seeded)
  expect(await db.products.count()).toBe(0)
  expect(server.get('products', KOKUMARO)?.data).toBeNull()
  expect(server.get('categories', CURRY)?.data).toMatchObject({ id: CURRY })
})

test('形の壊れた行は飛ばして先に進む。1行のために同期全体を止めない', async () => {
  const server = fakeServer()
  const OTHER = '4901234567894'
  server.put({ tbl: 'reviews', key: 'broken', data: { intent: 'yes' }, at: 1 }) // 主キーが無い
  server.put({ tbl: 'reviews', key: KOKUMARO, data: { jan: OTHER, intent: 'yes' }, at: 2 }) // key と主キーが違う
  server.put({ tbl: 'reviews', key: OTHER, data: { jan: OTHER, intent: 'yes' }, at: 3 }) // tags / history が無い
  server.put({ tbl: 'categories', key: '食品/後続', data: { id: '食品/後続', major: '食品', minor: '後続' }, at: 4 })

  expect(await syncNow(server.fetchImpl)).toBe('synced')
  expect(await db.reviews.count()).toBe(1)
  expect(await db.reviews.get(OTHER)).toMatchObject({ intent: 'yes', tags: [], history: [] })
  expect(await db.categories.get('食品/後続')).toBeDefined()
  expect(await syncNow(server.fetchImpl)).toBe('synced')
  expect((await db.meta.get('sync'))?.error).toBeUndefined()
})

test('同期中に触った行は、受け取った古い版で上書きされず、次の同期で送られる', async () => {
  const server = fakeServer()
  await upsertProduct({ jan: KOKUMARO, name: 'v1', categoryId: CURRY })
  await syncNow(server.fetchImpl)
  // 別の端末が名前を直した
  server.put({ tbl: 'products', key: KOKUMARO, data: { ...(await db.products.get(KOKUMARO)), name: 'from-other' }, at: Date.now() })
  // こちらは送信の最中に直した（fetch の中で書き込む）
  const slow = (async (input: RequestInfo | URL, init?: RequestInit) => {
    await upsertProduct({ jan: KOKUMARO, name: 'mine-newer', categoryId: CURRY })
    return server.fetchImpl(input, init)
  }) as typeof fetch
  expect(await syncNow(slow)).toBe('synced')
  expect((await db.products.get(KOKUMARO))?.name).toBe('mine-newer')
  expect(await db.outbox.count()).toBe(1)
  expect(await syncNow(server.fetchImpl)).toBe('synced')
  expect(server.get('products', KOKUMARO)?.data).toMatchObject({ name: 'mine-newer' })
})

test('インポートした分も同期に載る', async () => {
  const server = fakeServer()
  await syncNow(server.fetchImpl)
  await importBackup(
    JSON.stringify({
      app: 'matakore',
      version: 1,
      products: [{ jan: KOKUMARO, name: 'imported', categoryId: CURRY, source: 'manual', fetchedAt: 1 }],
      reviews: [{ jan: KOKUMARO, intent: 'meh', tags: [], updatedAt: 1, history: [] }],
    }),
  )
  await syncNow(server.fetchImpl)
  expect(server.get('products', KOKUMARO)?.data).toMatchObject({ name: 'imported' })
  expect(server.get('reviews', KOKUMARO)?.data).toMatchObject({ intent: 'meh' })
})

test('ログイン切れ・圏外・サーバーエラーは止めずに結果だけ返す', async () => {
  const login = (async () => new Response('', { status: 401 })) as typeof fetch
  expect(await syncNow(login)).toBe('login')
  const offline = (async () => {
    throw new TypeError('Failed to fetch')
  }) as unknown as typeof fetch
  expect(await syncNow(offline)).toBe('offline')
  const broken = (async () => new Response(JSON.stringify({ error: 'boom' }), { status: 502 })) as typeof fetch
  expect(await syncNow(broken)).toBe('error')
  // 結果は残すが、初回接続が済んでいないので cursor は無い（次も初回として全部受け取り直す）
  expect(await db.meta.get('sync')).toMatchObject({ error: 'boom' })
  expect((await db.meta.get('sync'))?.cursor).toBeUndefined()
})

test('初回同期がログイン切れでも設定画面に残り、次回はまた初回として受け取り直す', async () => {
  const login = (async () => new Response('', { status: 401 })) as typeof fetch
  expect(await syncNow(login)).toBe('login')
  expect((await db.meta.get('sync'))?.error).toContain('ログイン')

  const server = fakeServer()
  server.put({ tbl: 'categories', key: '食品/直した', data: { id: '食品/直した', major: '食品', minor: '直した' }, at: 1 })
  expect(await syncNow(server.fetchImpl)).toBe('synced')
  expect(await db.categories.get('食品/直した')).toBeDefined()
  expect((await db.meta.get('sync'))?.error).toBeUndefined()
})
