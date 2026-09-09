import { expect, test } from 'vitest'
import { MISS_TTL_MS, type MasterCache } from '../cache'
import { isValidJan } from '../jan'
import { resolveJan } from '../resolve'
import { offSource } from '../sources/off'
import { rakutenSource } from '../sources/rakuten'
import { yahooSource } from '../sources/yahoo'
import type { ResolvedProduct, Source } from '../types'

const JAN = '4902102072618'

const memoryCache = () => {
  const products = new Map<string, ResolvedProduct>()
  const misses = new Map<string, number>()
  const cache: MasterCache = {
    async get(jan) {
      return products.get(jan) ?? null
    },
    async put(jan, p) {
      products.set(jan, p)
      misses.delete(jan)
    },
    async isRecentMiss(jan, now) {
      const at = misses.get(jan)
      return at !== undefined && now - at < MISS_TTL_MS
    },
    async markMiss(jan, now) {
      misses.set(jan, now)
    },
  }
  return { cache, products, misses }
}

const hit = (source: ResolvedProduct['source'], rawName: string): Source => async () => ({ rawName, source })
const miss: Source = async () => null
const boom: Source = async () => {
  throw new Error('down')
}

test('チェックディジットが合わない JAN は弾く', () => {
  expect(isValidJan(JAN)).toBe(true)
  expect(isValidJan('4902102072619')).toBe(false)
  expect(isValidJan('49021020')).toBe(false)
  expect(isValidJan('4901234567894')).toBe(true)
})

test('上位ソースが失敗しても下位で拾い、結果はキャッシュされる', async () => {
  const { cache, products } = memoryCache()
  const r = await resolveJan(JAN, { cache, sources: [boom, miss, hit('off', 'Kokumaro Curry')], now: () => 1000 })
  expect(r).toEqual({
    jan: JAN,
    found: true,
    cached: false,
    product: { rawName: 'Kokumaro Curry', source: 'off', fetchedAt: 1000 },
  })
  expect(products.get(JAN)?.source).toBe('off')
})

test('複数ソースが当たったら優先順の高い方を採る', async () => {
  const { cache } = memoryCache()
  const r = await resolveJan(JAN, { cache, sources: [hit('yahoo', 'Y'), hit('rakuten', 'R')] })
  expect(r.found && r.product.source).toBe('yahoo')
})

test('上位ソースが当たったら下位の応答を待たない', async () => {
  const { cache } = memoryCache()
  const never: Source = () => new Promise(() => {})
  const r = await Promise.race([
    resolveJan(JAN, { cache, sources: [hit('yahoo', 'Y'), never] }),
    new Promise<'timeout'>((res) => setTimeout(() => res('timeout'), 200)),
  ])
  expect(r).not.toBe('timeout')
  expect(typeof r === 'object' && r.found && r.product.source).toBe('yahoo')
})

test('2回目はキャッシュから返し、外部ソースを叩かない', async () => {
  const { cache } = memoryCache()
  let calls = 0
  const counting: Source = async () => {
    calls++
    return { rawName: 'X', source: 'yahoo' }
  }
  await resolveJan(JAN, { cache, sources: [counting] })
  const r = await resolveJan(JAN, { cache, sources: [counting] })
  expect(calls).toBe(1)
  expect(r.cached).toBe(true)
})

test('未発見は一定期間覚えておき、期限が切れたら再検索する', async () => {
  const { cache } = memoryCache()
  let calls = 0
  const counting: Source = async () => {
    calls++
    return null
  }
  const deps = { cache, sources: [counting] }
  expect((await resolveJan(JAN, { ...deps, now: () => 0 })).found).toBe(false)
  expect((await resolveJan(JAN, { ...deps, now: () => 1 })).cached).toBe(true)
  expect(calls).toBe(1)
  await resolveJan(JAN, { ...deps, now: () => MISS_TTL_MS + 1 })
  expect(calls).toBe(2)
})

test('一部のソースが落ちた回の未発見はキャッシュしない', async () => {
  const { cache, misses } = memoryCache()
  const r = await resolveJan(JAN, { cache, sources: [boom, miss], now: () => 0 })
  expect(r).toEqual({ jan: JAN, found: false, cached: false })
  expect(misses.size).toBe(0)
  // 全ソースが正常に「無い」と答えたときだけ覚える
  await resolveJan(JAN, { cache, sources: [miss, miss], now: () => 0 })
  expect(misses.size).toBe(1)
})

test('全ソースが落ちたらエラーにする（「無い」と「分からない」を混ぜない）', async () => {
  const { cache } = memoryCache()
  await expect(resolveJan(JAN, { cache, sources: [boom, boom] })).rejects.toThrow('all sources failed')
})

test('refresh=1 はキャッシュを飛ばして取り直す', async () => {
  const { cache } = memoryCache()
  await resolveJan(JAN, { cache, sources: [hit('rakuten', 'old')] })
  const r = await resolveJan(JAN, { cache, sources: [hit('yahoo', 'new')] }, { refresh: true })
  expect(r.found && r.product.rawName).toBe('new')
})

const mockFetch = (body: unknown, status = 200) => {
  const calls: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input))
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return calls
}

test('Yahoo: JAN 一致かつメーカー入りの出品を優先する', async () => {
  const calls = mockFetch({
    hits: [
      { name: '【送料無料】こくまろカレー 中辛 140g×5個', janCode: JAN },
      { name: 'ハウス こくまろカレー 中辛 140g', janCode: JAN, brand: { name: 'ハウス食品' }, image: { medium: 'https://img/m.jpg' } },
    ],
  })
  const r = await yahooSource('APP')(JAN)
  expect(r).toEqual({
    rawName: 'ハウス こくまろカレー 中辛 140g',
    brand: 'ハウス食品',
    imageUrl: 'https://img/m.jpg',
    source: 'yahoo',
  })
  expect(calls[0]).toContain('jan_code=' + JAN)
  expect(calls[0]).toContain('appid=APP')
})

test('Yahoo: hits が空なら null', async () => {
  mockFetch({ totalResultsAvailable: 0, hits: [] })
  expect(await yahooSource('APP')(JAN)).toBeNull()
})

test('楽天: formatVersion=2 の items を読む', async () => {
  const calls = mockFetch({ items: [{ itemName: 'こくまろカレー 中辛 まとめ買い', mediumImageUrls: ['https://r/1.jpg?_ex=128x128'] }] })
  expect(await rakutenSource('RK')(JAN)).toEqual({
    rawName: 'こくまろカレー 中辛 まとめ買い',
    imageUrl: 'https://r/1.jpg?_ex=128x128',
    source: 'rakuten',
  })
  expect(calls[0]).toContain('keyword=' + JAN)
})

test('OFF: status=1 でも名前が空なら未発見', async () => {
  mockFetch({ status: 1, product: { product_name: '' } })
  expect(await offSource('ua')(JAN)).toBeNull()
})

test('OFF: 日本語名を優先し、brands の先頭をメーカーにする', async () => {
  mockFetch({ status: 1, product: { product_name: 'Nutella', product_name_ja: 'ヌテラ', brands: 'Nutella, Ferrero' } })
  expect(await offSource('ua')(JAN)).toEqual({ rawName: 'ヌテラ', brand: 'Nutella', imageUrl: undefined, source: 'off' })
})

test('HTTP エラーは throw する（呼び出し側が握る）', async () => {
  mockFetch({}, 500)
  await expect(offSource('ua')(JAN)).rejects.toThrow('500')
})
