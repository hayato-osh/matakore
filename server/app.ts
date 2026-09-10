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
import type { Source } from './types'

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

app.use('/api/*', async (c, next) => {
  c.header('cache-control', 'no-store')
  // ローカル開発（vite dev）の前には Access がいないので、.dev.vars でだけ検証を外す。
  // wrangler.jsonc の vars には置かないこと（置くと本番でも外れる）
  if (c.env.DEV_NO_AUTH === '1') return next()
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

const userOf = (c: Context<AppEnv>) => userIdOf(c.get('jwtPayload'), c.env.DEV_NO_AUTH === '1')

app.post('/api/sync', async (c) => {
  const user = userOf(c)
  if (!user) return c.json({ error: 'no identity' }, 401)
  const req = parseSyncRequest(await c.req.json().catch(() => null))
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

app.onError((e, c) => {
  // bearerAuth の 401 など、意図して投げた応答はそのまま返す
  if (e instanceof HTTPException) return e.getResponse()
  console.error(JSON.stringify({ event: 'unhandled', path: c.req.path, error: e.message }))
  return c.json({ error: 'request failed' }, 502)
})

export default app
