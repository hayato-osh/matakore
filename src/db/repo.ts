import { db, newId } from './db'
import type { Category, Product, Purchase, RepeatIntent, Review } from './types'

export const INTENT_RANK: Record<RepeatIntent, number> = { staple: 0, yes: 1, meh: 2, no: 3 }

export type RelatedEntry = { product: Product; review: Review }

export type Verdict = {
  jan: string
  product?: Product
  category?: Category
  review?: Review
  purchases: Purchase[]
  /** 同カテゴリの評価済み商品。未登録商品でもここで判断材料を出す（§3.2） */
  related: RelatedEntry[]
  /** 同メーカーの評価済み商品 */
  sameBrand: RelatedEntry[]
}

const byIntentThenRecency = (a: RelatedEntry, b: RelatedEntry) =>
  INTENT_RANK[a.review.intent] - INTENT_RANK[b.review.intent] || b.review.updatedAt - a.review.updatedAt

const withReviews = async (products: Product[]): Promise<RelatedEntry[]> => {
  if (products.length === 0) return []
  const reviews = await db.reviews.bulkGet(products.map((p) => p.jan))
  const entries: RelatedEntry[] = []
  products.forEach((product, i) => {
    const review = reviews[i]
    if (review) entries.push({ product, review })
  })
  return entries.sort(byIntentThenRecency)
}

export const relatedByCategory = async (categoryId: string, excludeJan?: string) => {
  const products = await db.products.where('categoryId').equals(categoryId).toArray()
  return withReviews(products.filter((p) => p.jan !== excludeJan))
}

export const relatedByBrand = async (brand: string, excludeJan?: string) => {
  const products = await db.products.where('brand').equals(brand).toArray()
  return withReviews(products.filter((p) => p.jan !== excludeJan))
}

/**
 * 店頭で見る判定ビューを1クエリ分の呼び出しにまとめる。
 * 未登録商品でも空を返さず、同カテゴリ／同メーカーの記録を返すのが要点。
 * 「この商品は初めてだが、このメーカーのパスタソースは2回とも微妙だった」を出せるようにする。
 */
export const getVerdict = async (jan: string, categoryHint?: string): Promise<Verdict> => {
  const product = await db.products.get(jan)
  const [review, purchases] = await Promise.all([
    db.reviews.get(jan),
    db.purchases.where('jan').equals(jan).toArray(),
  ])
  const catId = product?.categoryId ?? categoryHint
  const [category, related, sameBrand] = await Promise.all([
    catId ? db.categories.get(catId) : undefined,
    catId ? relatedByCategory(catId, jan) : [],
    product?.brand ? relatedByBrand(product.brand, jan) : [],
  ])
  // 同カテゴリに出したものを同メーカーでもう一度出さない。
  // 棚の前で同じ行を二度読ませるのは、それだけで判断を遅らせる。
  const shown = new Set(related.map((r) => r.product.jan))

  return {
    jan,
    product,
    category,
    review,
    purchases: purchases.sort((a, b) => b.purchasedAt - a.purchasedAt),
    related,
    sameBrand: sameBrand.filter((r) => !shown.has(r.product.jan)),
  }
}

export type ProductInput = {
  jan: string
  name: string
  rawName?: string
  brand?: string
  categoryId: string
}

/** 商品マスタの upsert。fetchedAt / source は既存値を尊重する（手入力で上書きしても由来を消さない）。 */
export const upsertProduct = async (input: ProductInput) => {
  const existing = await db.products.get(input.jan)
  const product: Product = {
    ...existing,
    jan: input.jan,
    name: input.name,
    rawName: input.rawName ?? existing?.rawName,
    brand: input.brand || undefined,
    categoryId: input.categoryId,
    source: existing?.source ?? 'manual',
    fetchedAt: existing?.fetchedAt ?? Date.now(),
  }
  await db.products.put(product)
  return product
}

export const recordPurchase = async (
  jan: string,
  opts: { price?: number; store?: string; purchasedAt?: number } = {},
) => {
  const purchase: Purchase = {
    id: newId(),
    jan,
    purchasedAt: opts.purchasedAt ?? Date.now(),
    price: opts.price,
    store: opts.store || undefined,
  }
  await db.purchases.add(purchase)
  return purchase
}

export const deletePurchase = (id: string) => db.purchases.delete(id)

export type ReviewInput = {
  intent: RepeatIntent
  memo?: string
  tags: string[]
  stars?: number
}

/** 評価の保存。intent が変わったときだけ history に積む（心変わりも情報）。 */
export const saveReview = async (jan: string, input: ReviewInput) => {
  const existing = await db.reviews.get(jan)
  const now = Date.now()
  const history = existing?.history ?? []
  const review: Review = {
    jan,
    intent: input.intent,
    memo: input.memo?.trim() || undefined,
    tags: input.tags,
    stars: input.stars,
    updatedAt: now,
    history:
      existing && existing.intent === input.intent
        ? history
        : [...history, { intent: input.intent, at: now }],
  }
  await db.reviews.put(review)
  return review
}

export const deleteReview = (jan: string) => db.reviews.delete(jan)

/** 誤スキャンの後始末。評価も購入履歴もまとめて消す。 */
export const deleteProductCascade = async (jan: string) => {
  await db.transaction('rw', db.products, db.purchases, db.reviews, async () => {
    await db.products.delete(jan)
    await db.reviews.delete(jan)
    await db.purchases.where('jan').equals(jan).delete()
  })
}

export type QueueEntry = { product: Product; lastPurchasedAt?: number; purchaseCount: number }

/**
 * 未評価キュー（Phase B）。買ったが評価がまだ無い商品。
 * 溜まっても構わない設計なので、催促は件数バッジだけに留める。
 */
export const unreviewedQueue = async (): Promise<QueueEntry[]> => {
  const [products, reviews, purchases] = await Promise.all([
    db.products.toArray(),
    db.reviews.toArray(),
    db.purchases.toArray(),
  ])
  const reviewed = new Set(reviews.map((r) => r.jan))
  const stats = new Map<string, { last: number; count: number }>()
  for (const p of purchases) {
    const s = stats.get(p.jan)
    if (!s) stats.set(p.jan, { last: p.purchasedAt, count: 1 })
    else {
      s.count += 1
      if (p.purchasedAt > s.last) s.last = p.purchasedAt
    }
  }
  return products
    .filter((p) => !reviewed.has(p.jan))
    .map((product) => ({
      product,
      lastPurchasedAt: stats.get(product.jan)?.last,
      purchaseCount: stats.get(product.jan)?.count ?? 0,
    }))
    .sort((a, b) => (b.lastPurchasedAt ?? 0) - (a.lastPurchasedAt ?? 0))
}

export const stats = async () => {
  const [products, purchases, reviews, categories] = await Promise.all([
    db.products.count(),
    db.purchases.count(),
    db.reviews.count(),
    db.categories.count(),
  ])
  return { products, purchases, reviews, categories, unreviewed: products - reviews }
}
