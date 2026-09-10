import 'fake-indexeddb/auto'
import { beforeEach, expect, test } from 'vitest'
import { db, ensureSeeded } from '../db'
import { buildBackup, buildReviewsCsv, importBackup, wipeAll } from '../export'
import {
  getVerdict,
  recordPurchase,
  relatedByCategory,
  saveReview,
  unreviewedQueue,
  upsertProduct,
} from '../repo'

const CURRY = '食品/カレー・ハヤシ'
const KOKUMARO = '4902102072618'
const GOLDEN = '4901872000012'

const seedFixture = async () => {
  await upsertProduct({
    jan: KOKUMARO,
    name: 'こくまろカレー 中辛 140g',
    rawName: '【送料無料】こくまろカレー 中辛 140g×5個',
    brand: 'ハウス食品',
    categoryId: CURRY,
  })
  await recordPurchase(KOKUMARO)
  await recordPurchase(KOKUMARO, { price: 298, store: 'ライフ' })
}

beforeEach(async () => {
  if (db.isOpen()) db.close()
  await db.delete()
  await db.open()
  await ensureSeeded()
})

test('カテゴリがシードされる', async () => {
  expect(await db.categories.count()).toBeGreaterThan(50)
})

test('購入を重ねると判定に回数と最終購入日が出る', async () => {
  await seedFixture()
  const v = await getVerdict(KOKUMARO)
  expect(v.purchases.length).toBe(2)
  expect(v.category?.minor).toBe('カレー・ハヤシ')
  expect(v.review).toBeUndefined()
  expect(v.purchases[0].purchasedAt).toBeGreaterThanOrEqual(v.purchases[1].purchasedAt)
})

test('intent を変えたときだけ history に積む', async () => {
  await seedFixture()
  await saveReview(KOKUMARO, { intent: 'yes', memo: '甘め', tags: ['常備'] })
  await saveReview(KOKUMARO, { intent: 'yes', memo: '甘めだが常備でいい', tags: ['常備'] })
  await saveReview(KOKUMARO, { intent: 'staple', tags: [] })
  const v = await getVerdict(KOKUMARO)
  expect(v.review?.intent).toBe('staple')
  expect(v.review?.history.map((h) => h.intent)).toEqual(['yes', 'staple'])
})

test('未評価キューは評価済みを除く', async () => {
  await seedFixture()
  await saveReview(KOKUMARO, { intent: 'yes', tags: [] })
  await upsertProduct({ jan: GOLDEN, name: 'ゴールデンカレー 中辛', brand: 'エスビー食品', categoryId: CURRY })
  await recordPurchase(GOLDEN)
  const queue = await unreviewedQueue()
  expect(queue.map((q) => q.product.jan)).toEqual([GOLDEN])
  expect(queue[0].purchaseCount).toBe(1)
})

test('未登録の JAN でも同カテゴリの記録を返す', async () => {
  await seedFixture()
  await saveReview(KOKUMARO, { intent: 'meh', memo: '甘すぎ', tags: [] })
  const v = await getVerdict('4912345678904', CURRY)
  expect(v.product).toBeUndefined()
  expect(v.related.map((r) => r.product.jan)).toEqual([KOKUMARO])
})

test('同カテゴリに出したものは同メーカーで重複させない', async () => {
  await seedFixture()
  // 同じメーカー・同じカテゴリの別商品
  await upsertProduct({ jan: GOLDEN, name: 'バーモントカレー 甘口', brand: 'ハウス食品', categoryId: CURRY })
  await saveReview(GOLDEN, { intent: 'yes', tags: [] })
  const v = await getVerdict(KOKUMARO)
  expect(v.related.map((r) => r.product.jan)).toEqual([GOLDEN])
  expect(v.sameBrand).toEqual([])
})

test('同カテゴリの記録は intent の良い順に並ぶ', async () => {
  await seedFixture()
  await upsertProduct({ jan: GOLDEN, name: 'ゴールデンカレー 中辛', categoryId: CURRY })
  await saveReview(KOKUMARO, { intent: 'no', tags: [] })
  await saveReview(GOLDEN, { intent: 'staple', tags: [] })
  const related = await relatedByCategory(CURRY)
  expect(related.map((r) => r.product.jan)).toEqual([GOLDEN, KOKUMARO])
})

test('評価CSV は商品名・カテゴリ・タグを join する', async () => {
  await seedFixture()
  await saveReview(KOKUMARO, { intent: 'staple', memo: '常備でいい', tags: ['常備', '子供受け'] })
  const csv = await buildReviewsCsv()
  expect(csv).toContain('こくまろカレー 中辛 140g')
  expect(csv).toContain('カレー・ハヤシ')
  expect(csv).toContain('常備 子供受け')
  expect(csv).toContain(',staple,')
})

test('CSV は数式として評価される値を文字列に倒す', async () => {
  await seedFixture()
  await upsertProduct({ jan: GOLDEN, name: '=HYPERLINK("http://evil","値引き")', categoryId: CURRY })
  await saveReview(GOLDEN, { intent: 'yes', memo: '@SUM(A1:A9)', tags: [] })
  const csv = await buildReviewsCsv()
  expect(csv).toContain(`"'=HYPERLINK(""http://evil"",""値引き"")"`)
  expect(csv).toContain(`'@SUM(A1:A9)`)
  expect(csv).not.toMatch(/(^|,)=HYPERLINK/m)
})

test('完全バックアップは往復できる', async () => {
  await seedFixture()
  await saveReview(KOKUMARO, { intent: 'staple', memo: '常備', tags: [] })
  const backup = await buildBackup()

  await wipeAll()
  expect(await db.products.count()).toBe(0)

  const result = await importBackup(JSON.stringify(backup))
  expect(result.products).toBe(1)
  expect(result.purchases).toBe(2)
  expect(result.reviews).toBe(1)

  const v = await getVerdict(KOKUMARO)
  expect(v.review?.intent).toBe('staple')
  expect(v.product?.rawName).toBe('【送料無料】こくまろカレー 中辛 140g×5個')
  expect(v.purchases.length).toBe(2)
})

test('他アプリの JSON は取り込まない', async () => {
  await expect(importBackup(JSON.stringify({ app: 'other', reviews: [] }))).rejects.toThrow()
})
