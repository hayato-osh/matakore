// 外部API呼び出しの共通部。1ソースに掛ける時間はここで区切る。
// 店頭で待たせられるのは合計で数秒なので、1ソースが遅いだけで全体を道連れにしない。
// Open Food Facts はコールドで 3〜4 秒かかることがある。
export const SOURCE_TIMEOUT_MS = 5000

/**
 * 1レスポンスで読む上限。時間は区切っているがサイズは野放しだったので、上流が壊れる・
 * 経路に何か挟まると Worker のメモリごと持っていかれる。商品5件の JSON は数十 KB で収まる。
 */
export const SOURCE_MAX_BYTES = 512 * 1024

/**
 * 外部API由来の文字列の上限。ここで通した値は D1 に焼かれ、以後キャッシュヒットのたびに
 * 全端末へ配られる（消すには refresh=1 で取り直すしかない）。上流が壊れたときに
 * 巨大な値が固定化しないよう、常識的な長さで切る。商品名は長くても100字程度。
 */
const MAX_TEXT = 200

/** URL は文字列としては長くなりうるので別枠 */
const MAX_URL = 2000

const readCapped = async (res: Response) => {
  const reader = res.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let out = ''
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > SOURCE_MAX_BYTES) {
      await reader.cancel()
      throw new Error(`response exceeded ${SOURCE_MAX_BYTES} bytes`)
    }
    out += decoder.decode(value, { stream: true })
  }
  return out + decoder.decode()
}

export const fetchJson = async <T>(url: string, init: RequestInit = {}): Promise<T> => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`)
  return JSON.parse(await readCapped(res)) as T
}

export const clean = (s: unknown, max = MAX_TEXT) =>
  typeof s === 'string' && s.trim() ? s.trim().slice(0, max) : undefined

/**
 * 商品画像の URL。入る先が <img src> なので https だけ通す。
 * http は混在コンテンツで表示できず、data: / javascript: はそもそも外部APIが返す理由が無い。
 */
export const cleanImageUrl = (s: unknown) => {
  const v = clean(s, MAX_URL)
  if (!v) return undefined
  try {
    return new URL(v).protocol === 'https:' ? v : undefined
  } catch {
    return undefined
  }
}
