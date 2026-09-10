import { expect, test } from 'vitest'
import app from '../app'

// D1 の最小のダミー。products / misses が空の状態を表す。
const emptyD1 = () => {
  const stmt = {
    bind: () => stmt,
    first: async () => null,
    run: async () => ({}),
    all: async () => ({ results: [] }),
  }
  return { prepare: () => stmt, batch: async () => [] } as unknown as D1Database
}

const TEAM = 'example.cloudflareaccess.com'
const AUD = 'aud-tag-1234'

const env = (over: Partial<Env> = {}): Env => ({
  DB: emptyD1(),
  OFF_USER_AGENT: 'ua',
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUD,
  DEV_NO_AUTH: '',
  YAHOO_APP_ID: '',
  RAKUTEN_APP_ID: '',
  ...over,
})

// Access が発行する JWT を模す。RS256 の鍵を作り、JWKS を fetch モックで返す。
const b64url = (b: ArrayBuffer | string) =>
  btoa(typeof b === 'string' ? b : String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const makeAccess = async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const jwks = { keys: [{ ...pub, kid: 'k1', use: 'sig', alg: 'RS256' }] }
  const token = async (claims: Record<string, unknown>) => {
    const now = Math.floor(Date.now() / 1000)
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'k1' }))
    const payload = b64url(
      JSON.stringify({ iss: `https://${TEAM}`, aud: [AUD], email: 'me@example.com', iat: now, exp: now + 600, ...claims }),
    )
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${header}.${payload}`))
    return `${header}.${payload}.${b64url(sig)}`
  }
  return { jwks, token }
}

/** JWKS だけ返し、それ以外の fetch は与えた応答を返す */
const mockFetch = (jwks: unknown, other: () => Response) => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/cdn-cgi/access/certs')) return new Response(JSON.stringify(jwks))
    return other()
  }) as typeof fetch
}

const access = await makeAccess()
mockFetch(access.jwks, () => new Response('{}', { status: 500 }))
const auth = { Cookie: `CF_Authorization=${await access.token({})}` }

test('Access 未設定なら誰も通さない', async () => {
  const res = await app.request('/api/health', { headers: auth }, env({ ACCESS_AUD: '' }))
  expect(res.status).toBe(503)
})

test('クッキー無し・改ざん・別 aud・期限切れは 401', async () => {
  expect((await app.request('/api/health', {}, env())).status).toBe(401)
  const t = await access.token({})
  expect((await app.request('/api/health', { headers: { Cookie: `CF_Authorization=${t}x` } }, env())).status).toBe(401)
  const other = await access.token({ aud: ['someone-else'] })
  expect((await app.request('/api/health', { headers: { Cookie: `CF_Authorization=${other}` } }, env())).status).toBe(401)
  const expired = await access.token({ exp: Math.floor(Date.now() / 1000) - 10 })
  expect((await app.request('/api/health', { headers: { Cookie: `CF_Authorization=${expired}` } }, env())).status).toBe(401)
})

test('DEV_NO_AUTH=1 はローカル開発用の迂回', async () => {
  const res = await app.request('/api/health', {}, env({ DEV_NO_AUTH: '1' }))
  expect(res.status).toBe(200)
})

test('login は Access を通った後にアプリ（/）へ戻す。クッキー無しは 401', async () => {
  const res = await app.request('/api/login', { headers: auth }, env())
  expect(res.status).toBe(302)
  expect(res.headers.get('location')).toBe('/')
  expect((await app.request('/api/login', {}, env())).status).toBe(401)
})

test('health は有効なソースを返す', async () => {
  const res = await app.request('/api/health', { headers: auth }, env({ YAHOO_APP_ID: 'y' }))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true, sources: ['yahoo', 'off'], user: 'me@example.com' })
  expect(res.headers.get('cache-control')).toBe('no-store')
})

test('チェックディジットが合わない JAN は外部を叩かずに 400', async () => {
  const res = await app.request('/api/resolve/4902102072619', { headers: auth }, env())
  expect(res.status).toBe(400)
})

test('resolve は外部ソースの結果を JSON で返す', async () => {
  mockFetch(access.jwks, () => new Response(JSON.stringify({ status: 1, product: { product_name: 'Nutella', brands: 'Ferrero' } })))
  const res = await app.request('/api/resolve/3017620422003', { headers: auth }, env())
  expect(res.status).toBe(200)
  const body = (await res.json()) as { found: boolean; product?: { rawName: string; source: string } }
  expect(body.found).toBe(true)
  expect(body.product).toMatchObject({ rawName: 'Nutella', brand: 'Ferrero', source: 'off' })
})

test('全ソースが落ちたら 502（「無い」と「分からない」を混ぜない）', async () => {
  mockFetch(access.jwks, () => new Response('', { status: 500 }))
  const res = await app.request('/api/resolve/3017620422003', { headers: auth }, env())
  expect(res.status).toBe(502)
})

test('sync は Access の本人でだけ動き、形の合わない body は 400', async () => {
  const body = JSON.stringify({ cursor: 0, changes: [] })
  const post = (init: RequestInit, e = env()) =>
    app.request('/api/sync', { method: 'POST', headers: { ...(init.headers ?? {}), 'content-type': 'application/json' }, ...init }, e)
  expect((await post({ body })).status).toBe(401)
  const ok = await post({ body, headers: auth })
  expect(ok.status).toBe(200)
  expect(await ok.json()).toEqual({ cursor: 0, changes: [], more: false })
  expect((await post({ body: '{"cursor":"x"}', headers: auth })).status).toBe(400)
  expect((await post({ body: 'not json', headers: auth })).status).toBe(400)
  // ローカル開発では固定ユーザー dev として動く
  expect((await post({ body }, env({ DEV_NO_AUTH: '1' }))).status).toBe(200)
})

test('backup はアプリのエクスポートと同じ形', async () => {
  const res = await app.request('/api/backup', { headers: auth }, env())
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ app: 'matakore', version: 1, products: [], purchases: [], reviews: [], categories: [] })
})

test('/api 以外の未知のパスは 404 JSON', async () => {
  const res = await app.request('/api/nope', { headers: auth }, env())
  expect(res.status).toBe(404)
})
