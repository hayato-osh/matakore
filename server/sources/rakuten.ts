import type { Source } from '../types'
import { clean, fetchJson } from './http'

// 楽天市場 商品検索API。JAN 専用パラメータは無く keyword に JAN を入れる（§4.2 第4段）。
// https://webservice.rakuten.co.jp/documentation/ichiba-item-search
// キーワード検索なので無関係な出品が混ざりうる。登録画面で名前を編集できるのが前提。

type RakutenItem = {
  itemName?: string
  // formatVersion=2 では文字列の配列。旧形式の { imageUrl } も念のため受ける
  mediumImageUrls?: (string | { imageUrl?: string })[]
}
type RakutenResponse = { items?: RakutenItem[]; Items?: { Item?: RakutenItem }[] }

export const rakutenSource = (appId: string): Source => async (jan) => {
  const url = new URL('https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701')
  url.searchParams.set('applicationId', appId)
  url.searchParams.set('keyword', jan)
  url.searchParams.set('hits', '5')
  url.searchParams.set('formatVersion', '2')
  const data = await fetchJson<RakutenResponse>(url.toString())
  const items = data.items ?? data.Items?.map((w) => w.Item).filter((i): i is RakutenItem => !!i) ?? []
  const item = items.find((i) => clean(i.itemName))
  if (!item) return null
  const img = item.mediumImageUrls?.[0]
  return {
    rawName: item.itemName!.trim(),
    imageUrl: typeof img === 'string' ? clean(img) : clean(img?.imageUrl),
    source: 'rakuten',
  }
}
