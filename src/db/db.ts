import Dexie, { type Table } from 'dexie'
import { seedCategories } from './categories'
import { outboxMiddleware, silently, type Outbox, type SyncMeta, type SyncTable } from './outbox'
import type { Category, Product, Purchase, Review } from './types'

// 判定は完全にローカルだけで成立させる（§6.1）。全件を IndexedDB に持ち、
// 参照パスに一切のネットワークアクセスを入れない。店内は電波が期待できない。
// outbox / meta は差分同期（Phase 2）の帳尻合わせ用で、判定には関わらない。
class MatakoreDB extends Dexie {
  products!: Table<Product, string>
  purchases!: Table<Purchase, string>
  reviews!: Table<Review, string>
  categories!: Table<Category, string>
  outbox!: Table<Outbox, [SyncTable, string]>
  meta!: Table<SyncMeta, string>

  constructor() {
    super('matakore')
    // Dexie 3 以降は最新の版だけ宣言すればよい（upgrade 関数が無いので過去の版は不要）。
    // v1 → v2 は outbox / meta を足しただけで、既存の4テーブルは触っていない。
    this.version(2).stores({
      products: 'jan, categoryId, brand, name, fetchedAt',
      purchases: 'id, jan, purchasedAt',
      reviews: 'jan, intent, updatedAt, *tags',
      categories: 'id, major, minor',
      outbox: '[tbl+key]',
      meta: 'key',
    })
    this.use(outboxMiddleware(() => dirtyListeners.forEach((l) => l())))
  }
}

const dirtyListeners = new Set<() => void>()

/** 同期対象のテーブルに書き込みがあったときに呼ばれる。同期の起動はここに繋ぐ（lib/sync.ts）。 */
export const onDirty = (listener: () => void) => {
  dirtyListeners.add(listener)
  return () => dirtyListeners.delete(listener)
}

export const db = new MatakoreDB()

/** 同期の読み書きで、テーブル名から中身の型を問わずに触るための入口。 */
export const syncTable = (tbl: SyncTable) => db[tbl] as unknown as Table<Record<string, unknown>, string>

/**
 * 起動時に一度だけカテゴリをシードする。ユーザーが消したカテゴリは復活させない。
 * 同期には載せない。新しい端末でシードした分は、初回同期でサーバーが知らないものだけを送る
 * （載せると、古い端末で消したカテゴリを新しい端末のシードが蘇らせてしまう）。
 */
export const ensureSeeded = async () => {
  const count = await db.categories.count()
  if (count > 0) return
  await db.transaction('rw', db.categories, async (tx) => {
    silently(tx)
    await db.categories.bulkPut(seedCategories())
  })
}

/**
 * 「サーバーの控えも含めて削除」の後の再シード。ensureSeeded と違い、同期に載せる。
 * サーバーには全カテゴリの墓標が残っているので、黙って入れ直すと初回同期で墓標に消される。
 * 未送信として積んでおけば墓標より新しい行として送られ、この端末にも他の端末にも戻る。
 */
export const reseedForSync = () => db.categories.bulkPut(seedCategories())

export const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
