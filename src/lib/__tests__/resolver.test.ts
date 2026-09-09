import { expect, test } from 'vitest'
import { checkResolver, resolveJan } from '../resolver'

const JAN = '4902102072618'

const fakeFetch = (body: unknown, status = 200) => {
  const calls: { url: string; redirect?: RequestRedirect }[] = []
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), redirect: init?.redirect })
    return new Response(JSON.stringify(body), { status })
  }) as typeof fetch
  return { f, calls }
}

test('見つかったら product を返す。同一オリジンの /api を相対パスで呼び、リダイレクトは追わない', async () => {
  const product = { rawName: 'こくまろカレー', brand: 'ハウス食品', source: 'yahoo', fetchedAt: 1 }
  const { f, calls } = fakeFetch({ jan: JAN, found: true, product, cached: false })
  expect(await resolveJan(JAN, f)).toEqual({ status: 'found', product, cached: false })
  expect(calls[0]).toEqual({ url: `/api/resolve/${JAN}`, redirect: 'manual' })
})

test('found=false は notfound', async () => {
  const { f } = fakeFetch({ jan: JAN, found: false, cached: true })
  expect(await resolveJan(JAN, f)).toEqual({ status: 'notfound' })
})

test('Access のログイン切れ（302 → opaqueredirect / 401）は login', async () => {
  // redirect: 'manual' で 302 を受けたときにブラウザが返す形（type だけが手掛かり）
  const redirect = (async () => ({ type: 'opaqueredirect', status: 0, ok: false, json: async () => ({}) })) as unknown as typeof fetch
  expect(await resolveJan(JAN, redirect)).toEqual({ status: 'login' })
  const { f } = fakeFetch('Unauthorized', 401)
  expect(await resolveJan(JAN, f)).toEqual({ status: 'login' })
})

test('fetch 自体が失敗したら offline（手入力に落ちる）', async () => {
  const f = (async () => {
    throw new TypeError('Failed to fetch')
  }) as unknown as typeof fetch
  expect(await resolveJan(JAN, f)).toEqual({ status: 'offline' })
})

test('サーバーのエラー応答は error', async () => {
  const { f } = fakeFetch({ error: 'resolve failed' }, 502)
  const r = await resolveJan(JAN, f)
  expect(r).toEqual({ status: 'error', message: 'resolve failed' })
})

test('接続確認はログイン中のユーザーと有効なソースを返す', async () => {
  const { f, calls } = fakeFetch({ ok: true, sources: ['yahoo', 'off'], user: 'me@example.com' })
  expect(await checkResolver(f)).toEqual({ ok: true, sources: ['yahoo', 'off'], user: 'me@example.com' })
  expect(calls[0].url).toBe('/api/health')
})
