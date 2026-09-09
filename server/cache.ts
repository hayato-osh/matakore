import type { ResolvedProduct } from './types'

// 見つからなかった JAN を覚えておく期間。新商品が EC に載るまでの猶予としてこのくらい。
export const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** 解決結果の共有キャッシュ。テストでは in-memory 実装に差し替える。 */
export type MasterCache = {
  get(jan: string): Promise<ResolvedProduct | null>
  put(jan: string, product: ResolvedProduct): Promise<void>
  /** 直近の「見つからなかった」記録があれば true */
  isRecentMiss(jan: string, now: number): Promise<boolean>
  markMiss(jan: string, now: number): Promise<void>
}

type Row = {
  jan: string
  raw_name: string
  brand: string | null
  image_url: string | null
  source: ResolvedProduct['source']
  fetched_at: number
}

export const d1Cache = (db: D1Database): MasterCache => ({
  async get(jan) {
    const row = await db.prepare('SELECT * FROM products WHERE jan = ?1').bind(jan).first<Row>()
    if (!row) return null
    return {
      rawName: row.raw_name,
      brand: row.brand ?? undefined,
      imageUrl: row.image_url ?? undefined,
      source: row.source,
      fetchedAt: row.fetched_at,
    }
  },
  async put(jan, p) {
    await db.batch([
      db
        .prepare(
          `INSERT INTO products (jan, raw_name, brand, image_url, source, fetched_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)
           ON CONFLICT(jan) DO UPDATE SET
             raw_name = excluded.raw_name, brand = excluded.brand, image_url = excluded.image_url,
             source = excluded.source, fetched_at = excluded.fetched_at`,
        )
        .bind(jan, p.rawName, p.brand ?? null, p.imageUrl ?? null, p.source, p.fetchedAt),
      db.prepare('DELETE FROM misses WHERE jan = ?1').bind(jan),
    ])
  },
  async isRecentMiss(jan, now) {
    const row = await db
      .prepare('SELECT checked_at FROM misses WHERE jan = ?1')
      .bind(jan)
      .first<{ checked_at: number }>()
    return !!row && now - row.checked_at < MISS_TTL_MS
  },
  async markMiss(jan, now) {
    await db
      .prepare('INSERT INTO misses (jan, checked_at) VALUES (?1, ?2) ON CONFLICT(jan) DO UPDATE SET checked_at = excluded.checked_at')
      .bind(jan, now)
      .run()
  },
})
