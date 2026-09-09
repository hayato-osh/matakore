// DESIGN.md §5 のデータモデル。
// 商品マスタ（Product / 外部由来・再取得可能）と評価（Review / 代替不能）を厳密に分離する。
// この境界はエクスポートとバックアップの単位でもあるので、片方にもう片方を埋め込まない。

export type RepeatIntent = 'staple' | 'yes' | 'meh' | 'no'

export type MajorCategory = '食品' | '飲料' | '日用品' | '菓子'

export type ProductSource = 'yahoo' | 'rakuten' | 'off' | 'manual'

/** 商品マスタ。外部APIまたは手入力由来。再取得可能。 */
export type Product = {
  jan: string
  /** 正規化後の商品名 */
  name: string
  /** API生データ。正規化ミスの復元用に必ず残す */
  rawName?: string
  brand?: string
  imageUrl?: string
  categoryId: string
  source: ProductSource
  fetchedAt: number
}

/** 購入イベント。何回買ったかを追う。 */
export type Purchase = {
  id: string
  jan: string
  purchasedAt: number
  price?: number
  store?: string
}

export type IntentChange = { intent: RepeatIntent; at: number }

/** 評価。アプリの中核資産。商品に対して1件、更新可。 */
export type Review = {
  jan: string
  intent: RepeatIntent
  memo?: string
  tags: string[]
  stars?: number
  updatedAt: number
  /** 心変わりも情報として残す */
  history: IntentChange[]
}

/** カテゴリ。2階層固定。深くしない。 */
export type Category = {
  id: string
  major: MajorCategory
  minor: string
}
