import { createHash } from 'node:crypto'
import { cloudflare } from '@cloudflare/vite-plugin'
import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// HTTPS=1 pnpm dev:host で自己署名 HTTPS を有効にする。
// iOS Safari はセキュアコンテキスト以外で getUserMedia を許可しないため、
// LAN 経由で iPhone 実機からカメラを試すときはこれが必要になる。
const useHttps = process.env.HTTPS === '1'

// 設定画面に出すビルド時刻（JST）。PWA でどの版が動いているかを見分けるため
const buildId = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ')

/**
 * 静的アセットのセキュリティヘッダ。Cloudflare の静的アセットは配信ディレクトリ直下の
 * `_headers` を読む。vite の dev サーバーは読まないので、効くのは build 以降（preview と本番）。
 * /api/* は静的アセットではないので、そちらは server/app.ts が自分で付ける。
 *
 * CSP で一番効くのは script-src ではなく `connect-src 'self'` の方。判定に使う全記録が
 * IndexedDB にある以上、万一 XSS が入ったときに「外に送れない」ことが最後の壁になる。
 *
 * script-src のハッシュは、出来上がった index.html のインラインスクリプト（テーマの先当て）から
 * build のたびに計算する。ここに手で書き写すと、あのスクリプトを1文字直した瞬間に CSP が
 * 黙って効かなくなり、「墨にしている人だけ起動時に一瞬光る」形でしか気づけない。
 */
const securityHeaders = (): Plugin => ({
  name: 'matakore:security-headers',
  apply: 'build',
  enforce: 'post',
  generateBundle(_options, bundle) {
    const html = bundle['index.html']
    // Worker 側のビルドには index.html が無い。その環境では何も出さない
    if (!html || html.type !== 'asset') return
    const inline = [...String(html.source).matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    const hashes = inline.map((m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`)

    const csp = [
      "default-src 'self'",
      // zxing-wasm（iOS の BarcodeDetector 不在を埋めるフォールバック）は WebAssembly を
      // コンパイルする。Chrome は CSP があると 'wasm-unsafe-eval' 無しでこれを拒む＝店頭でスキャンが死ぬ
      `script-src 'self' 'wasm-unsafe-eval' ${hashes.join(' ')}`,
      // CSS Modules は build では外部ファイルに出る。'unsafe-inline' は vite が差し込む
      // 小さな style（PWA プラグイン等）が将来増えても画面が壊れないための保険で、
      // ここを締めても防げるものが無い（CSS 注入はこのアプリの脅威ではない）
      "style-src 'self' 'unsafe-inline'",
      // 商品画像は EC の CDN（ホストは商品ごとに変わるので https: でまとめる）。
      // data: は tokens.css の --grain（紙の粒子の SVG）が使う
      "img-src 'self' https: data:",
      "font-src 'self'",
      // 記録の持ち出し口を塞ぐ。このアプリが話す相手は同一オリジンの /api だけ
      "connect-src 'self'",
      "worker-src 'self'",
      "manifest-src 'self'",
      "media-src 'self' blob:",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'none'",
    ].join('; ')

    this.emitFile({
      type: 'asset',
      fileName: '_headers',
      source: [
        '# vite.config.ts の securityHeaders プラグインが build のたびに生成する。手で編集しない',
        '/*',
        '  X-Content-Type-Options: nosniff',
        '  X-Frame-Options: DENY',
        '  Referrer-Policy: no-referrer',
        '  Cross-Origin-Opener-Policy: same-origin',
        '  Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=(), usb=()',
        `  Content-Security-Policy: ${csp}`,
        '',
      ].join('\n'),
    })
  },
})

// https://vite.dev/config/
export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  plugins: [
    react(),
    ...(useHttps ? [basicSsl()] : []),
    // Worker（server/）を Vite の開発サーバの中で動かし、/api/* を同じオリジンで受ける。
    // ビルドでは dist/client（静的アセット）と dist/matakore（Worker + wrangler.json）に分けて出す。
    cloudflare(),
    // Service Worker とマニフェストはクライアント側だけの話。Worker のビルドにまで混ぜない
    ...VitePWA({
      registerType: 'autoUpdate',
      // 登録は src/lib/sw.ts で行う（起動時・復帰時・1時間ごとの更新確認を足すため）
      injectRegister: null,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        // zxing の wasm と日本語フォントを含めてプリキャッシュする。
        // 店内（電波なし）でスキャンが死ぬのと、字が代替フォントに落ちるのを防ぐため。
        // .woff は woff2 の保険なので焼かない（対応していないブラウザは想定していない）。
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // /api/* は Worker のもの。SPA のフォールバック（index.html）に吸わせない
        navigateFallbackDenylist: [/^\/api\//],
      },
      manifest: {
        name: 'matakore — またこれ',
        short_name: 'matakore',
        description: 'バーコードを読むと「また買うか」が3秒で分かる、個人の食品評価データベース',
        lang: 'ja',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ece4d3',
        theme_color: '#ece4d3',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }).map((p) => ({ ...p, applyToEnvironment: (env: { name: string }) => env.name === 'client' })),
    securityHeaders(),
  ],
  server: { host: true },
})
