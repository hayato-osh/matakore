// Worker ↔ PWA の契約。クライアント側 src/lib/resolver.ts と対で保つ。

export type ResolvedSource = 'yahoo' | 'rakuten' | 'off'

/** 外部API由来の商品スナップショット。名前は正規化前の生データで返し、正規化はクライアントに任せる。 */
export type ResolvedProduct = {
  rawName: string
  brand?: string
  imageUrl?: string
  source: ResolvedSource
  fetchedAt: number
}

export type ResolveResponse =
  | { jan: string; found: true; product: ResolvedProduct; cached: boolean }
  | { jan: string; found: false; cached: boolean }

/** 各ソースのアダプタ。見つからなければ null、失敗は throw（呼び出し側で握る）。 */
export type SourceHit = Omit<ResolvedProduct, 'fetchedAt'>
export type Source = (jan: string) => Promise<SourceHit | null>

// ---- 差分同期（§6.2 の /sync）。クライアント側 src/lib/sync.ts と対で保つ。

export const SYNC_TABLES = ['products', 'purchases', 'reviews', 'categories'] as const
export type SyncTable = (typeof SYNC_TABLES)[number]

/** 1レコードの変更。data が null なら削除（墓標）。at はクライアントでの変更時刻で、新しい方が勝つ。 */
export type SyncChange = {
  tbl: SyncTable
  key: string
  data: Record<string, unknown> | null
  at: number
}

/** cursor は前回受け取った最後の seq（初回は 0）。changes は未送信の変更。 */
export type SyncRequest = { cursor: number; changes: SyncChange[] }

/** changes は cursor より後の変更（自分が今送ったものは除く）。more なら同じ cursor で続きを取る。 */
export type SyncResponse = { cursor: number; changes: SyncChange[]; more: boolean }

/** 1往復で運ぶ上限（push も pull も）。これを超える分は次の往復に回す。 */
export const SYNC_PAGE = 500

/**
 * 1行の JSON の上限（文字数）。メモは 120 字、履歴は心変わりの回数分しか増えないので、実データは数 KB で収まる。
 * D1 の 1 行 1MB に半端に当たって失敗するより、入口で 400 にする。
 */
export const SYNC_MAX_DATA_CHARS = 64_000

/**
 * 1リクエストの全行の合計（文字数）。上の2つを掛けると 500 × 64,000 = 3,200 万字まで通ってしまい、
 * Worker のメモリ（128MB）に当たって 502 になる。実データは 500 行でも数 MB に届かない。
 */
export const SYNC_MAX_TOTAL_CHARS = 2_000_000

/**
 * content-length の上限（バイト）。上の合計に日本語の 3 バイト/字と JSON の骨組みぶんの余裕を足した値。
 * body を読み切る前に 413 で落とすためのもので、本番の判定は SYNC_MAX_TOTAL_CHARS が行う。
 */
export const SYNC_MAX_BODY_BYTES = 8 * 1024 * 1024
