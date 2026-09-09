import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// HTTPS=1 pnpm dev:host で自己署名 HTTPS を有効にする。
// iOS Safari はセキュアコンテキスト以外で getUserMedia を許可しないため、
// LAN 経由で iPhone 実機からカメラを試すときはこれが必要になる。
const useHttps = process.env.HTTPS === '1'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    ...(useHttps ? [basicSsl()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        // zxing の wasm と日本語フォントを含めてプリキャッシュする。
        // 店内（電波なし）でスキャンが死ぬのと、字が代替フォントに落ちるのを防ぐため。
        // .woff は woff2 の保険なので焼かない（対応していないブラウザは想定していない）。
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
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
    }),
  ],
  server: { host: true },
})
