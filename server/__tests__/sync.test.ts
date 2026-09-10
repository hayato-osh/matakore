import { expect, test } from 'vitest'
import type { RecordRow, RecordStore } from '../records'
import { buildBackup, parseSyncRequest, runSync, userIdOf, wipeRecords } from '../sync'
import { SYNC_MAX_DATA_CHARS, SYNC_PAGE, type SyncChange } from '../types'

// D1 の records と同じ意味論を in-memory で。seq はユーザー内で単調増加、古い変更は捨てる。
const memoryStore = () => {
  const rows = new Map<string, RecordRow & { user: string }>()
  const k = (user: string, tbl: string, key: string) => `${user}/${tbl}/${key}`
  const maxSeq = (user: string) => Math.max(0, ...[...rows.values()].filter((r) => r.user === user).map((r) => r.seq))
  const store: RecordStore = {
    async upsert(user, changes) {
      for (const c of changes) {
        const id = k(user, c.tbl, c.key)
        const cur = rows.get(id)
        if (cur && c.at < cur.updated_at) continue
        rows.set(id, {
          user,
          tbl: c.tbl,
          key: c.key,
          data: c.data === null ? null : JSON.stringify(c.data),
          updated_at: c.at,
          seq: maxSeq(user) + 1,
        })
      }
    },
    async since(user, cursor, limit) {
      return [...rows.values()]
        .filter((r) => r.user === user && r.seq > cursor)
        .sort((a, b) => a.seq - b.seq)
        .slice(0, limit)
    },
    async all(user) {
      return [...rows.values()].filter((r) => r.user === user).sort((a, b) => a.seq - b.seq)
    },
  }
  return { store, rows }
}

const put = (tbl: SyncChange['tbl'], key: string, data: Record<string, unknown>, at: number): SyncChange => ({ tbl, key, data, at })
const del = (tbl: SyncChange['tbl'], key: string, at: number): SyncChange => ({ tbl, key, data: null, at })

test('同期の主体は Access の email。無ければ sub、ローカル開発だけ dev', () => {
  expect(userIdOf({ email: 'me@example.com', sub: 's' }, false)).toBe('me@example.com')
  expect(userIdOf({ sub: 's' }, false)).toBe('s')
  expect(userIdOf(undefined, false)).toBeUndefined()
  expect(userIdOf(undefined, true)).toBe('dev')
})

test('リクエストの検証: 知らないテーブル・空のキー・上限超えは弾く', () => {
  expect(parseSyncRequest({ cursor: 0, changes: [] })).toEqual({ cursor: 0, changes: [] })
  expect(parseSyncRequest({ cursor: -1, changes: [] })).toBeNull()
  expect(parseSyncRequest({ cursor: 0, changes: [{ tbl: 'users', key: 'a', data: {}, at: 1 }] })).toBeNull()
  expect(parseSyncRequest({ cursor: 0, changes: [{ tbl: 'reviews', key: '', data: {}, at: 1 }] })).toBeNull()
  expect(parseSyncRequest({ cursor: 0, changes: [{ tbl: 'reviews', key: 'a', data: [], at: 1 }] })).toBeNull()
  expect(parseSyncRequest({ cursor: 0, changes: Array(SYNC_PAGE + 1).fill(del('reviews', 'a', 1)) })).toBeNull()
  // 余計なフィールドは落とす
  expect(parseSyncRequest({ cursor: 0, changes: [{ tbl: 'reviews', key: 'a', data: null, at: 1, extra: 1 }] })).toEqual({
    cursor: 0,
    changes: [del('reviews', 'a', 1)],
  })
  // key と中身の主キーが食い違う行（墓標が効かなくなる）と、大きすぎる行は弾く
  expect(parseSyncRequest({ cursor: 0, changes: [put('reviews', 'a', { jan: 'b' }, 1)] })).toBeNull()
  expect(parseSyncRequest({ cursor: 0, changes: [put('purchases', 'a', { jan: 'a' }, 1)] })).toBeNull()
  expect(parseSyncRequest({ cursor: 0, changes: [put('categories', 'a', { id: 'a' }, 1)] })).toEqual({
    cursor: 0,
    changes: [put('categories', 'a', { id: 'a' }, 1)],
  })
  // 大きすぎるのは形の不正（null）と分ける。クライアントは切って送り直せる
  expect(parseSyncRequest({ cursor: 0, changes: [put('reviews', 'a', { jan: 'a', memo: 'x'.repeat(SYNC_MAX_DATA_CHARS) }, 1)] })).toBe('too-large')
})

test('1行ずつは上限内でも、合計が大きすぎるリクエストは弾く', () => {
  // 1行 64,000 字 × 500 行を全部通すと 3,200 万字。Worker のメモリに当たる前に入口で止める
  const fat = (i: number) => put('reviews', `j${i}`, { jan: `j${i}`, memo: 'x'.repeat(SYNC_MAX_DATA_CHARS - 100) }, 1)
  const changes = Array.from({ length: SYNC_PAGE }, (_, i) => fat(i))
  expect(parseSyncRequest({ cursor: 0, changes })).toBe('too-large')
  // 実データの大きさ（1行あたり数 KB）なら 500 行でも通る
  const normal = Array.from({ length: SYNC_PAGE }, (_, i) =>
    put('reviews', `j${i}`, { jan: `j${i}`, intent: 'yes', memo: 'x'.repeat(120) }, 1),
  )
  const parsed = parseSyncRequest({ cursor: 0, changes: normal })
  expect(parsed).not.toBe('too-large')
  expect(parsed && parsed !== 'too-large' && parsed.changes.length).toBe(SYNC_PAGE)
})

test('端末Aが送った変更を端末Bが cursor 以降として受け取る。送った本人には返さない', async () => {
  const { store } = memoryStore()
  const a = await runSync(store, 'u', { cursor: 0, changes: [put('reviews', 'j1', { jan: 'j1', intent: 'yes' }, 100)] }, 1000)
  expect(a).toEqual({ cursor: 1, changes: [], more: false })

  const b = await runSync(store, 'u', { cursor: 0, changes: [] }, 1000)
  expect(b.changes).toEqual([put('reviews', 'j1', { jan: 'j1', intent: 'yes' }, 100)])
  expect(b.cursor).toBe(1)

  // 何も変わっていなければ空
  expect(await runSync(store, 'u', { cursor: 1, changes: [] }, 1000)).toEqual({ cursor: 1, changes: [], more: false })
})

test('新しい方が勝つ。負けた側にはサーバーの版を返して上書きさせる', async () => {
  const { store } = memoryStore()
  await runSync(store, 'u', { cursor: 0, changes: [put('reviews', 'j1', { intent: 'staple' }, 200)] }, 1000)
  // 端末B は 200 より前に付けた評価を、後から送ってきた
  const b = await runSync(store, 'u', { cursor: 0, changes: [put('reviews', 'j1', { intent: 'meh' }, 150)] }, 1000)
  expect(b.changes).toEqual([put('reviews', 'j1', { intent: 'staple' }, 200)])
  // 同時刻は入ってきた方
  const c = await runSync(store, 'u', { cursor: b.cursor, changes: [put('reviews', 'j1', { intent: 'no' }, 200)] }, 1000)
  expect(c.changes).toEqual([])
  expect((await store.all('u'))[0].data).toBe(JSON.stringify({ intent: 'no' }))
})

test('削除は墓標として伝わる', async () => {
  const { store } = memoryStore()
  await runSync(store, 'u', { cursor: 0, changes: [put('purchases', 'p1', { id: 'p1' }, 100)] }, 1000)
  await runSync(store, 'u', { cursor: 1, changes: [del('purchases', 'p1', 200)] }, 1000)
  const other = await runSync(store, 'u', { cursor: 0, changes: [] }, 1000)
  expect(other.changes).toEqual([del('purchases', 'p1', 200)])
  const backup = await buildBackup(store, 'u', 5)
  expect(backup).toEqual({ app: 'matakore', version: 1, exportedAt: 5, products: [], purchases: [], reviews: [], categories: [] })
})

test('未来の時刻は今に丸める（時計が進んだ端末に永遠に勝たせない）', async () => {
  const { store } = memoryStore()
  await runSync(store, 'u', { cursor: 0, changes: [put('reviews', 'j1', { v: 1 }, 99_999)] }, 1000)
  expect((await store.all('u'))[0].updated_at).toBe(1000)
})

test('ページング: 上限を超えたら more で続きを促す', async () => {
  const { store } = memoryStore()
  const many = Array.from({ length: SYNC_PAGE + 3 }, (_, i) => put('purchases', `p${i}`, { i }, 1))
  await store.upsert('u', many)
  const first = await runSync(store, 'u', { cursor: 0, changes: [] }, 1000)
  expect(first.changes.length).toBe(SYNC_PAGE)
  expect(first.more).toBe(true)
  const rest = await runSync(store, 'u', { cursor: first.cursor, changes: [] }, 1000)
  expect(rest.changes.length).toBe(3)
  expect(rest.more).toBe(false)
})

test('ユーザーは混ざらない', async () => {
  const { store } = memoryStore()
  await runSync(store, 'a', { cursor: 0, changes: [put('reviews', 'j1', { a: 1 }, 1)] }, 1000)
  expect((await runSync(store, 'b', { cursor: 0, changes: [] }, 1000)).changes).toEqual([])
})

test('サーバーの控えの全削除は墓標で行い、別の端末にも削除が伝わる', async () => {
  const { store } = memoryStore()
  await runSync(store, 'u', { cursor: 0, changes: [put('reviews', 'j1', { a: 1 }, 1), put('products', 'j1', { a: 1 }, 1)] }, 1000)
  expect(await wipeRecords(store, 'u', 2000)).toBe(2)
  const other = await runSync(store, 'u', { cursor: 2, changes: [] }, 3000)
  expect(other.changes).toEqual([del('reviews', 'j1', 2000), del('products', 'j1', 2000)])
  expect(other.cursor).toBe(4)
})
