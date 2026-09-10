// 同一オリジンの Worker（/api）を呼ぶ共通部分。resolver（JAN 解決）と sync（差分同期）が使う。
// API キーはクライアントに置かず、認証は Cloudflare Access のクッキーに任せる（§6.3）。
// アプリ側にトークンは無く、fetch に自動で付く CF_Authorization だけが手掛かり。

/** PWA と Worker は同じオリジン。相対パスで呼ぶので配信先が変わっても設定は要らない。 */
export const API_BASE = '/api'

export type ApiResult = { login: true } | { login: false; status: number; body: unknown }

/**
 * セッションが切れていると Access がログイン画面へ 302 を返す。redirect: 'manual' で追わずに
 * 「ログインが要る」として扱う（PWA の中でログイン画面を開いても戻ってこられない）。
 */
export const apiFetch = async (
  path: string,
  init: RequestInit & { timeoutMs: number },
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult> => {
  const { timeoutMs, ...rest } = init
  const res = await fetchImpl(`${API_BASE}${path}`, { ...rest, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
  if (res.type === 'opaqueredirect' || res.status === 401 || res.status === 403) return { login: true }
  const body: unknown = await res.json().catch(() => ({}))
  return { login: false, status: res.status, body }
}

export const errorOf = (body: unknown, status: number) =>
  typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
    ? body.error
    : `HTTP ${status}`

/** fetch 自体の失敗（圏外・DNS・タイムアウト）。原因の切り分けは設定画面の接続確認で行う */
export const isOfflineError = (e: unknown) =>
  e instanceof TypeError || (e instanceof DOMException && e.name === 'TimeoutError')

/**
 * Access のログインをやり直す。
 * 「/」へ遷移すると Service Worker が precache の index.html を返してネットワークに出ないため、
 * Access のログイン画面には辿り着けない。/api/* は SW の外なので、Worker の /api/login を踏ませる。
 * クッキーが無ければ Access がログイン画面へ飛ばし、通ると /api/login に戻ってきて Worker が「/」へ返す。
 */
export const relogin = () => location.assign('/api/login')
