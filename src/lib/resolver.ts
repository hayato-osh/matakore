import type { ProductSource } from '../db/types'
import { apiFetch, errorOf, isOfflineError, relogin } from './api'

// JAN → 商品マスタの解決（§4.2）。API キーはクライアントに置かず、必ず同一オリジンの Worker（/api）を経由する。
// 認証は Cloudflare Access のクッキーに任せ、アプリはトークンを持たない（§6.3）。
// ここは「未知の JAN を登録するとき」にだけ呼ばれる。判定パス（VerdictScreen / getVerdict）からは呼ばない。
// 店内は電波が期待できないので、失敗は全部「手入力に落ちる」だけで済ませ、ユーザーを待たせない。

export type ResolvedProduct = {
  rawName: string
  brand?: string
  imageUrl?: string
  source: Exclude<ProductSource, 'manual'>
  fetchedAt: number
}

export type ResolveResult =
  | { status: 'found'; product: ResolvedProduct; cached: boolean }
  | { status: 'notfound' }
  /** Cloudflare Access のログインが切れている。アプリを開き直せば再ログインできる */
  | { status: 'login' }
  | { status: 'offline' }
  | { status: 'error'; message: string }

/** 登録画面でこれ以上待たせない上限。Worker 側の1ソース上限（5秒）より少し長い。 */
export const RESOLVE_TIMEOUT_MS = 8000

export const SOURCE_LABEL: Record<ResolvedProduct['source'], string> = {
  yahoo: 'Yahoo!ショッピング',
  rakuten: '楽天市場',
  off: 'Open Food Facts',
}

type WireResponse =
  | { jan: string; found: true; product: ResolvedProduct; cached: boolean }
  | { jan: string; found: false; cached: boolean }
  | { error: string }

const request = async (path: string, fetchImpl: typeof fetch) => {
  const r = await apiFetch(path, { timeoutMs: RESOLVE_TIMEOUT_MS }, fetchImpl)
  if (r.login) return { login: true } as const
  if (r.status < 200 || r.status >= 300) throw new Error(errorOf(r.body, r.status))
  return r.body as WireResponse
}

export const resolveJan = async (jan: string, fetchImpl: typeof fetch = fetch): Promise<ResolveResult> => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { status: 'offline' }
  try {
    const body = await request(`/resolve/${jan}`, fetchImpl)
    if ('login' in body) return { status: 'login' }
    if (!('found' in body)) return { status: 'error', message: body.error }
    if (!body.found) return { status: 'notfound' }
    return { status: 'found', product: body.product, cached: body.cached }
  } catch (e) {
    // fetch 自体の失敗（圏外・DNS・タイムアウト）は offline 扱い
    if (isOfflineError(e)) return { status: 'offline' }
    return { status: 'error', message: e instanceof Error ? e.message : String(e) }
  }
}

/** 設定画面の「接続を確認」。ログイン中のユーザーと、どのソースが有効かを返す。 */
export const checkResolver = async (
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; sources: string[]; user?: string } | { ok: false; message: string }> => {
  try {
    const body = (await request('/health', fetchImpl)) as unknown as { login?: true; ok?: boolean; sources?: string[]; user?: string }
    if (body.login) return { ok: false, message: 'ログインが切れています。アプリを開き直してください' }
    if (!body.ok) return { ok: false, message: '応答が不正です' }
    return { ok: true, sources: body.sources ?? [], user: body.user }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export { relogin }
