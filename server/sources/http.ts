// 外部API呼び出しの共通部。1ソースに掛ける時間はここで区切る。
// 店頭で待たせられるのは合計で数秒なので、1ソースが遅いだけで全体を道連れにしない。
// Open Food Facts はコールドで 3〜4 秒かかることがある。
export const SOURCE_TIMEOUT_MS = 5000

export const fetchJson = async <T>(url: string, init: RequestInit = {}): Promise<T> => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`)
  return (await res.json()) as T
}

export const clean = (s: unknown) => (typeof s === 'string' && s.trim() ? s.trim() : undefined)
