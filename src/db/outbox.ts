import type { DBCore, DBCoreMutateRequest, DBCoreTransaction, Middleware, Transaction } from 'dexie'

// 差分同期（Phase 2）の「未送信」の記録。
// 4テーブルへの書き込みを Dexie のミドルウェアで横取りし、同じトランザクションの中で
// outbox に (tbl, key) を積む。repo を経由しない書き込み（カテゴリ追加・インポート）も漏れなく拾うため。
// 中身は積まない。送るときに現在の行を読む（無ければ削除として送る）ので、同じ行を何度直しても1件で済む。

export const SYNC_TABLES = ['products', 'purchases', 'reviews', 'categories'] as const
export type SyncTable = (typeof SYNC_TABLES)[number]

/** 未送信の1件。at は最後に触った時刻で、サーバーでの新旧比較に使う。 */
export type Outbox = { tbl: SyncTable; key: string; at: number }

/** 同期の状態。1行だけ（key = 'sync'）。無ければまだ一度もサーバーと話していない。 */
export type SyncMeta = { key: 'sync'; cursor: number; syncedAt?: number; error?: string }

const isSynced = (name: string): name is SyncTable => (SYNC_TABLES as readonly string[]).includes(name)

const SILENT = Symbol('matakore.silent')
type Marked = DBCoreTransaction & { [SILENT]?: true }

/**
 * このトランザクションの書き込みを outbox に積まない。
 * サーバーから受け取った変更を書くとき（積むと自分の変更として送り返して無限に回る）と、
 * カテゴリのシード・端末だけの全削除のように「同期させない」書き込みに使う。
 */
export const silently = (tx: Transaction) => {
  ;(tx.idbtrans as unknown as Marked)[SILENT] = true
}

export const outboxMiddleware = (onDirty: () => void): Middleware<DBCore> => ({
  stack: 'dbcore',
  name: 'outbox',
  create: (down) => ({
    ...down,
    // 書き込みトランザクションに outbox を同乗させる。暗黙のトランザクション（db.products.put）も
    // 明示のもの（db.transaction('rw', ...)）も、どちらもここを通って IDB のトランザクションになる
    transaction: (stores, mode, opts) => {
      const extend = mode === 'readwrite' && stores.some(isSynced) && !stores.includes('outbox')
      return down.transaction(extend ? [...stores, 'outbox'] : stores, mode, opts)
    },
    table: (name) => {
      const table = down.table(name)
      if (!isSynced(name)) return table
      // async/await を使わず .then で繋ぐ。Dexie は下層の呼び出しでトランザクションの文脈（PSD）を
      // Promise の連鎖から辿るので、ネイティブの await を挟むと下のミドルウェア（hooks）が文脈を見失う
      const record = (req: DBCoreMutateRequest, deleted: unknown[]) =>
        table.mutate(req).then((res) => {
          const keys = req.type === 'add' || req.type === 'put' ? (res.results ?? []) : deleted
          const at = Date.now()
          const values: Outbox[] = []
          keys.forEach((key, i) => {
            if (key != null && !(i in res.failures)) values.push({ tbl: name, key: String(key), at })
          })
          if (values.length === 0) return res
          return down
            .table('outbox')
            .mutate({ trans: req.trans, type: 'put', values })
            .then(() => {
              onDirty()
              return res
            })
        })
      return {
        ...table,
        mutate(req) {
          if ((req.trans as Marked)[SILENT]) return table.mutate(req)
          if (req.type === 'delete') return record(req, req.keys)
          // deleteRange（clear）は消える前でないとキーが分からない
          if (req.type === 'deleteRange') {
            return table
              .query({ trans: req.trans, query: { index: table.schema.primaryKey, range: req.range }, values: false })
              .then(({ result }) => record(req, result))
          }
          return record(req, [])
        },
      }
    },
  }),
})
