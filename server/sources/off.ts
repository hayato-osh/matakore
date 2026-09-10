import type { Source } from '../types'
import { clean, cleanImageUrl, fetchJson } from './http'

// Open Food Facts。オープンデータだが日本の食品カバレッジは薄い（§4.2 第5段、補助扱い）。
// status=1 でも product_name が空で返ることがあるので、名前が無ければ未発見として扱う。

type OffResponse = {
  status?: number
  product?: { product_name?: string; product_name_ja?: string; brands?: string; image_front_url?: string }
}

export const offSource = (userAgent: string): Source => async (jan) => {
  const url = `https://world.openfoodfacts.org/api/v2/product/${jan}?fields=product_name,product_name_ja,brands,image_front_url`
  const data = await fetchJson<OffResponse>(url, { headers: { 'User-Agent': userAgent } })
  if (data.status !== 1 || !data.product) return null
  const name = clean(data.product.product_name_ja) ?? clean(data.product.product_name)
  if (!name) return null
  // brands は "Nutella, Ferrero" のようにカンマ区切り。先頭だけをメーカーとして扱う
  const brand = clean(data.product.brands?.split(',')[0])
  return { rawName: name, brand, imageUrl: cleanImageUrl(data.product.image_front_url), source: 'off' }
}
