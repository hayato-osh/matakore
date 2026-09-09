import type { MasterCache } from './cache'
import type { ResolveResponse, Source, SourceHit } from './types'

export type ResolveDeps = {
  cache: MasterCache
  /** 優先順（§4.2 の段の順）。未設定のソースは含めない */
  sources: Source[]
  now?: () => number
  log?: (event: Record<string, unknown>) => void
}

/**
 * JAN → 商品のカスケード解決（§4.2）。
 * 共有マスタ（D1）→ 外部API の順。外部APIは優先順を保ったまま並列に叩き、
 * 優先順に結果を見ていって最初に当たったものを採る。上位が当たった時点で下位は待たない
 * （Yahoo! が 0.4 秒で答えているのに OFF の 5 秒タイムアウトに付き合うのは店頭では長すぎる）。
 * 逐次に落とすと最悪で 5秒×3 待たせることになる。無料枠のクォータより待ち時間を優先する。
 */
export const resolveJan = async (
  jan: string,
  { cache, sources, now = Date.now, log = () => {} }: ResolveDeps,
  opts: { refresh?: boolean } = {},
): Promise<ResolveResponse> => {
  const t = now()
  if (!opts.refresh) {
    const cached = await cache.get(jan)
    if (cached) return { jan, found: true, product: cached, cached: true }
    if (await cache.isRecentMiss(jan, t)) return { jan, found: false, cached: true }
  }

  type Settled = { ok: true; hit: SourceHit | null } | { ok: false; error: unknown }
  const started = sources.map((s) =>
    s(jan).then(
      (hit): Settled => ({ ok: true, hit }),
      (error): Settled => ({ ok: false, error }),
    ),
  )

  let failed = 0
  for (let i = 0; i < started.length; i++) {
    const r = await started[i]
    if (!r.ok) {
      failed++
      log({ event: 'source_error', jan, index: i, error: String(r.error) })
      continue
    }
    if (r.hit) {
      const product = { ...r.hit, fetchedAt: t }
      await cache.put(jan, product)
      return { jan, found: true, product, cached: false }
    }
  }

  // 全ソースが落ちたのは「無い」ではなく「分からない」。エラーとして返し、クライアントは手入力に落ちる
  if (sources.length > 0 && failed === sources.length) throw new Error('all sources failed')
  // 1つでもタイムアウトした回の「未発見」は信用しない。7日間その JAN を諦める根拠にならない
  if (failed === 0) await cache.markMiss(jan, t)
  return { jan, found: false, cached: false }
}
