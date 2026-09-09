import Dexie, { type Table } from 'dexie'
import { seedCategories } from './categories'
import type { Category, Product, Purchase, Review } from './types'

// 判定は完全にローカルだけで成立させる（§6.1）。全件を IndexedDB に持ち、
// 参照パスに一切のネットワークアクセスを入れない。店内は電波が期待できない。
class MatakoreDB extends Dexie {
  products!: Table<Product, string>
  purchases!: Table<Purchase, string>
  reviews!: Table<Review, string>
  categories!: Table<Category, string>

  constructor() {
    super('matakore')
    this.version(1).stores({
      products: 'jan, categoryId, brand, name, fetchedAt',
      purchases: 'id, jan, purchasedAt',
      reviews: 'jan, intent, updatedAt, *tags',
      categories: 'id, major, minor',
    })
  }
}

export const db = new MatakoreDB()

/** 起動時に一度だけカテゴリをシードする。ユーザーが消したカテゴリは復活させない。 */
export const ensureSeeded = async () => {
  const count = await db.categories.count()
  if (count > 0) return
  await db.categories.bulkPut(seedCategories())
}

export const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
