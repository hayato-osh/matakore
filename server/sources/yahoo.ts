import type { Source } from '../types'
import { clean, fetchJson } from './http'

// Yahoo!ショッピング 商品検索（v3）。JAN 指定検索に対応し、国内食品のカバレッジが最も広い（§4.2 第3段）。
// https://developer.yahoo.co.jp/webapi/shopping/v3/itemsearch.html

type YahooHit = {
  name?: string
  janCode?: string
  brand?: { name?: string }
  image?: { medium?: string; small?: string }
}
type YahooResponse = { totalResultsAvailable?: number; hits?: YahooHit[] }

export const yahooSource = (appId: string): Source => async (jan) => {
  const url = new URL('https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch')
  url.searchParams.set('appid', appId)
  url.searchParams.set('jan_code', jan)
  url.searchParams.set('results', '5')
  const data = await fetchJson<YahooResponse>(url.toString())
  const hits = (data.hits ?? []).filter((h) => clean(h.name))
  if (hits.length === 0) return null
  // 出品は複数返る。JAN が一致し、メーカー名が入っているものを優先する（出品タイトルよりノイズが少ない）
  const hit =
    hits.find((h) => h.janCode === jan && clean(h.brand?.name)) ??
    hits.find((h) => h.janCode === jan) ??
    hits[0]
  return {
    rawName: hit.name!.trim(),
    brand: clean(hit.brand?.name),
    imageUrl: clean(hit.image?.medium) ?? clean(hit.image?.small),
    source: 'yahoo',
  }
}
