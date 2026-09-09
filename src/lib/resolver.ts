import type { ProductSource } from '../db/types'

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

/** PWA と Worker は同じオリジン。相対パスで呼ぶので配信先が変わっても設定は要らない。 */
export const API_BASE = '/api'

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

/**
 * 認証は Cloudflare Access（§6.3）。ブラウザが持つ CF_Authorization クッキーが同一オリジンの
 * /api にそのまま付くので、アプリ側にトークンは無い。セッションが切れていると Access がログイン画面へ
 * 302 を返すので、redirect: 'manual' で追わずに「ログインが要る」として扱う。
 */
const request = async (path: string, fetchImpl: typeof fetch) => {
  const res = await fetchImpl(`${API_BASE}${path}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
  })
  if (res.type === 'opaqueredirect' || res.status === 401 || res.status === 403) return { login: true } as const
  const body = (await res.json().catch(() => ({}))) as WireResponse
  if (!res.ok) throw new Error('error' in body && body.error ? body.error : `HTTP ${res.status}`)
  return body
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
    // fetch 自体の失敗（圏外・DNS・タイムアウト）は offline 扱い。原因の切り分けは設定画面の接続確認で行う
    if (e instanceof TypeError || (e instanceof DOMException && e.name === 'TimeoutError')) {
      return { status: 'offline' }
    }
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

/**
 * Access のログインをやり直す。
 * 「/」へ遷移すると Service Worker が precache の index.html を返してネットワークに出ないため、
 * Access のログイン画面には辿り着けない。/api/* は SW の外なので、Worker の /api/login を踏ませる。
 * クッキーが無ければ Access がログイン画面へ飛ばし、通ると /api/login に戻ってきて Worker が「/」へ返す。
 */
export const relogin = () => location.assign('/api/login')
