import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ensureSeeded } from './db/db'
import { startServiceWorker } from './lib/sw'
import { applyTheme, getTheme } from './lib/theme'

// 日本語は Zen Kaku Gothic New 一書体（400 / 700）だけ。1ウェイト約 0.9MB あるので増やさない。
// CDN 参照は電波のない店内で死ぬため、Service Worker に載る形（バンドル同梱）で持つ。
// 等幅は JAN・日付・数値専用なのでラテンサブセットのみ（約 15KB）。
import '@fontsource/zen-kaku-gothic-new/japanese-400.css'
import '@fontsource/zen-kaku-gothic-new/latin-400.css'
import '@fontsource/zen-kaku-gothic-new/japanese-700.css'
import '@fontsource/zen-kaku-gothic-new/latin-700.css'
import '@fontsource/dm-mono/latin-400.css'
import './styles/tokens.css'
import './styles/global.css'

applyTheme(getTheme())
void ensureSeeded()
startServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
