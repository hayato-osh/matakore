import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { jwk } from 'hono/jwk'
import { d1Cache } from './cache'
import { isValidJan } from './jan'
import { d1Records } from './records'
import { resolveJan } from './resolve'
import { offSource } from './sources/off'
import { rakutenSource } from './sources/rakuten'
import { yahooSource } from './sources/yahoo'
import { buildBackup, parseSyncRequest, runSync, userIdOf, wipeRecords } from './sync'
import { SYNC_MAX_BODY_BYTES, type Source } from './types'

// Worker は薄いプロキシと同期に徹する（§6.2）。API キーはここから外に出ない。
// 判定パスにはこの Worker を含めない。PWA はローカルの IndexedDB だけで判定し、
// ここを呼ぶのは「未知の JAN を登録するとき」と「裏で記録の控えを D1 と合わせるとき」だけ。
// /api/* 以外は静的アセット（wrangler.jsonc の assets）に流れるので、ここには来ない。

const configuredSources = (env: Env): { sources: Source[]; names: string[] } => {
  const sources: Source[] = []
  const names: string[] = []
  if (env.YAHOO_APP_ID) {
    sources.push(yahooSource(env.YAHOO_APP_ID))
    names.push('yahoo')
  }
  if (env.RAKUTEN_APP_ID) {
    sources.push(rakutenSource(env.RAKUTEN_APP_ID))
    names.push('rakuten')
  }
  sources.push(offSource(env.OFF_USER_AGENT))
  names.push('off')
  return { sources, names }
}

// jwtPayload は Access の JWT の claims（email など）。jwk ミドルウェアが積む
type AccessClaims = { email?: string; sub?: string; exp?: number }
type AppEnv = { Bindings: Env; Variables: { jwtPayload?: AccessClaims } }
const app = new Hono<AppEnv>()

/**
 * API の応答に必ず付けるヘッダ。応答は文書として解釈されないので、sniff も埋め込みも読み込みも許さない。
 *
 * c.header() ではなく出来上がった Response に後から付ける。c.header() は下の CSRF が返す 403 と、
 * jwk ミドルウェアが投げる 401（HTTPException が自前の Response を持つ）に乗らない。
 * 認証に失敗した応答こそ他人が触るものなので、そこだけ裸になるのは順序が逆になる。
 */
const secure = (res: Response) => {
  res.headers.set('cache-control', 'no-store')
  res.headers.set('x-content-type-options', 'nosniff')
  res.headers.set('referrer-policy', 'no-referrer')
  res.headers.set('content-security-policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
  return res
}

// 一番外側に置く。ここより内側で作られた応答は、正常系も 403 も 404 も必ずここを通って出る
app.use('/api/*', async (c, next) => {
  await next()
  secure(c.res)
})

/**
 * CSRF 対策。認証がクッキーなので、他サイトのフォームから同期や全削除を送り込める余地を潰す。
 * ブラウザは他サイト発のリクエストに Sec-Fetch-Site（cross-site / same-site）を付け、フォーム送信には Origin も付く。
 * どちらも無いもの（curl 等）は、Access のクッキーが無ければどのみち 401 になる。
 */
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
app.use('/api/*', async (c, next) => {
  if (!MUTATING.has(c.req.method)) return next()
  const site = c.req.header('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') return c.json({ error: 'cross-site request' }, 403)
  const origin = c.req.header('origin')
  if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: 'cross-site request' }, 403)
  return next()
})

/**
 * DEV_NO_AUTH が効いてよいホスト名。ローカルと、`pnpm dev:host` で実機から見るときの
 * プライベート IP・mDNS 名まで。これ以外では DEV_NO_AUTH を無視する。
 */
const LOCAL_HOST =
  /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|[^.]+\.local|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/

const devBypass = (c: Context<AppEnv>) => c.env.DEV_NO_AUTH === '1' && LOCAL_HOST.test(new URL(c.req.url).hostname)

app.use('/api/*', async (c, next) => {
  // ローカル開発（vite dev）の前には Access がいないので、.dev.vars でだけ検証を外す。
  // wrangler.jsonc の vars には置かないこと（置くと本番でも外れる）。
  // 置かれてしまっても全公開にならないよう、ホスト名がローカルのときしか効かないようにする。
  if (devBypass(c)) return next()
  // Access の設定が無いのは「誰でも通す」ではなく「誰も通さない」に倒す
  if (!c.env.ACCESS_TEAM_DOMAIN || !c.env.ACCESS_AUD) return c.json({ error: 'Access is not configured' }, 503)
  return accessJwt(c.env)(c, next)
})

/**
 * Cloudflare Access（§6.3）。オリジン全体を Access が守り、通ったリクエストには
 * CF_Authorization クッキー（RS256 の JWT）が付く。Worker はそれを Access の JWKS で検証する。
 * workers.dev や直接アクセスで Access を迂回されないよう、クッキーが無ければ 401。
 */
const accessJwt = (env: Env) =>
  jwk(
    {
      jwks_uri: `https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`,
      cookie: 'CF_Authorization',
      alg: ['RS256'],
      verification: { iss: `https://${env.ACCESS_TEAM_DOMAIN}`, aud: env.ACCESS_AUD, exp: true },
    },
    // JWKS は数時間ごとにしか変わらない。毎リクエスト取りに行かず Cloudflare のキャッシュに載せる
    { cf: { cacheTtl: 3600, cacheEverything: true } },
  )

/**
 * 再ログインの入口。Service Worker は「/」への遷移を precache の index.html で返すので、
 * セッションが切れた PWA から「/」を開き直しても Access のログイン画面には辿り着けない。
 * /api/* は SW の navigateFallbackDenylist と run_worker_first の両方の外側にあるので、
 * ここへの遷移だけは必ずネットワーク → Access → （ログイン後）この Worker に届く。
 * 上の JWT 検証を通った時点でクッキーは新しいので、あとはアプリに戻すだけ。
 */
app.get('/api/login', (c) => c.redirect('/', 302))

app.get('/api/health', (c) => {
  const payload = c.get('jwtPayload')
  return c.json({ ok: true, sources: configuredSources(c.env).names, user: payload?.email })
})

app.get('/api/resolve/:jan', async (c) => {
  const jan = c.req.param('jan')
  if (!isValidJan(jan)) return c.json({ error: 'invalid jan' }, 400)
  const result = await resolveJan(
    jan,
    {
      cache: d1Cache(c.env.DB),
      sources: configuredSources(c.env).sources,
      log: (e) => console.log(JSON.stringify(e)),
    },
    { refresh: c.req.query('refresh') === '1' },
  )
  console.log(JSON.stringify({ event: 'resolve', jan, found: result.found, cached: result.cached }))
  return c.json(result)
})

// ---- 差分同期（Phase 2）。記録の控えを D1 に置き、機種変更で消えないようにする。
// 主体は Access の email。アプリ側にユーザーの概念は無く、ログインした本人の控えが自動で選ばれる。

const userOf = (c: Context<AppEnv>) => userIdOf(c.get('jwtPayload'), devBypass(c))

app.post('/api/sync', async (c) => {
  const user = userOf(c)
  if (!user) return c.json({ error: 'no identity' }, 401)
  // フォーム（text/plain）で JSON を偽装する CSRF の経路も、ここで閉じる
  if (!c.req.header('content-type')?.toLowerCase().includes('application/json')) {
    return c.json({ error: 'expected application/json' }, 415)
  }
  // 読み切ってから弾くと意味が無いので、申告された長さで先に落とす
  if (Number(c.req.header('content-length')) > SYNC_MAX_BODY_BYTES) {
    return c.json({ error: 'body too large' }, 413)
  }
  const req = parseSyncRequest(await c.req.json().catch(() => null))
  // 「送り方を変えれば通る」は 413。クライアントは切って送り直せる（src/lib/sync.ts の buildChanges）
  if (req === 'too-large') return c.json({ error: 'changes too large' }, 413)
  if (!req) return c.json({ error: 'invalid sync request' }, 400)
  const res = await runSync(d1Records(c.env.DB), user, req)
  console.log(
    JSON.stringify({ event: 'sync', user, pushed: req.changes.length, pulled: res.changes.length, cursor: res.cursor }),
  )
  return c.json(res)
})

/** D1 側の控えを、アプリのエクスポートと同じ形で丸ごと落とす。アプリが無くてもデータは取り出せる（§6.4）。 */
app.get('/api/backup', async (c) => {
  const user = userOf(c)
  if (!user) return c.json({ error: 'no identity' }, 401)
  c.header('content-disposition', `attachment; filename="matakore-backup.json"`)
  return c.json(await buildBackup(d1Records(c.env.DB), user))
})

/** サーバーの控えを全部消す（墓標にする）。設定画面の「サーバーの控えも含めて削除」から。 */
app.delete('/api/sync', async (c) => {
  const user = userOf(c)
  if (!user) return c.json({ error: 'no identity' }, 401)
  const deleted = await wipeRecords(d1Records(c.env.DB), user)
  console.log(JSON.stringify({ event: 'sync_wipe', user, deleted }))
  return c.json({ ok: true, deleted })
})

app.notFound((c) => c.json({ error: 'not found' }, 404))

// 投げられた応答は上の use を通らずにここへ来るので、ヘッダはこちらでも付ける
app.onError((e, c) => {
  // jwk ミドルウェアの 401 など、意図して投げた応答はそのまま返す
  if (e instanceof HTTPException) return secure(e.getResponse())
  console.error(JSON.stringify({ event: 'unhandled', path: c.req.path, error: e.message }))
  return secure(c.json({ error: 'request failed' }, 502))
})

export default app
