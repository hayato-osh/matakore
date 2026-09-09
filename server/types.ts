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
