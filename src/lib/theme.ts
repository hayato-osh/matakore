export type Theme = 'auto' | 'light' | 'dark'

const KEY = 'matakore.theme'

export const THEMES: { value: Theme; label: string }[] = [
  { value: 'auto', label: '自動' },
  { value: 'light', label: '和紙' },
  { value: 'dark', label: '墨' },
]

export const getTheme = (): Theme => {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

/**
 * 'auto' は data-theme を外して OS 設定（prefers-color-scheme）に委ねる。
 * 初回描画前に index.html のインラインスクリプトが同じことをしているので、
 * ここでの適用は切り替え時のみ効く。
 */
export const applyTheme = (theme: Theme) => {
  const root = document.documentElement
  if (theme === 'auto') root.removeAttribute('data-theme')
  else root.dataset.theme = theme

  // ブラウザのアドレスバーも地の色に合わせる。ここがずれると紙が途中で切れて見える。
  const dark =
    root.dataset.theme === 'dark' ||
    (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', dark ? '#15130f' : '#ece4d3')
}

export const setTheme = (theme: Theme) => {
  try {
    if (theme === 'auto') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, theme)
  } catch {
    // プライベートブラウズなどで書けなくても、その場の切り替えは効かせる
  }
  applyTheme(theme)
}
