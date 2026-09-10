import type { SyncTable } from './outbox'

// 同期（サーバーから受け取った行）とインポート（ファイルから読んだ行）の形を整える。
// 見るのは主キーと、無いと画面が落ちる項目だけ。将来の項目追加を弾かないよう、知らない項目は素通しする。
// 1行の不正で同期全体を止めない（cursor が進まず、毎回同じ行で失敗し続ける）ために、不正な行は null を返して呼び出し側が飛ばす。
// サーバー側 server/sync.ts の primaryKeyOf と対で保つ。

const INTENTS: readonly string[] = ['staple', 'yes', 'meh', 'no']

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** 同期の key と突き合わせる主キー。products / reviews は jan、purchases / categories は id */
export const primaryKeyOf = (tbl: SyncTable, row: Record<string, unknown>) =>
  tbl === 'purchases' || tbl === 'categories' ? row.id : row.jan

/** 形が通れば（欠けた配列などを補って）返す。通らなければ null */
export const sanitizeRow = (tbl: SyncTable, v: unknown): Record<string, unknown> | null => {
  if (!isObj(v)) return null
  switch (tbl) {
    case 'products':
      return str(v.jan) && str(v.name) && str(v.categoryId) ? v : null
    case 'purchases':
      return str(v.id) && str(v.jan) && num(v.purchasedAt) ? v : null
    case 'reviews':
      if (!str(v.jan) || typeof v.intent !== 'string' || !INTENTS.includes(v.intent)) return null
      return {
        ...v,
        tags: Array.isArray(v.tags) ? v.tags.filter(str) : [],
        history: Array.isArray(v.history) ? v.history : [],
        updatedAt: num(v.updatedAt) ? v.updatedAt : 0,
      }
    case 'categories':
      return str(v.id) && str(v.major) && str(v.minor) ? v : null
  }
}
