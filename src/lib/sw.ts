import { registerSW } from 'virtual:pwa-register'

// PWA は Service Worker がアプリ本体をまるごとキャッシュしているので、新しい版は
// 「裏で取得 → 次の起動で切り替え」の2段階になる。iOS はホーム画面アプリを凍結するだけで
// 終了しないことが多く、放っておくと古い版が何日も残る。起動時と1時間ごとに更新を確認し、
// 新しい SW が制御を取ったら（autoUpdate）そのまま再読み込みする。

const UPDATE_INTERVAL_MS = 60 * 60 * 1000

let registration: ServiceWorkerRegistration | undefined

export const startServiceWorker = () => {
  if (!('serviceWorker' in navigator)) return
  registerSW({
    immediate: true,
    onRegisteredSW(_url, r) {
      registration = r
      if (!r) return
      setInterval(() => void r.update(), UPDATE_INTERVAL_MS)
      // 凍結から復帰したときにも確認する（iOS の PWA はこの経路が主）
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void r.update()
      })
    },
  })
}

export type UpdateCheck = 'updating' | 'latest' | 'unsupported' | 'offline'

/** 設定画面の「更新を確認」。新しい SW が見つかれば autoUpdate が再読み込みまで行う。 */
export const checkForUpdate = async (): Promise<UpdateCheck> => {
  if (!registration) return 'unsupported'
  try {
    await registration.update()
  } catch {
    return 'offline'
  }
  return registration.installing || registration.waiting ? 'updating' : 'latest'
}

/** ビルド時刻。設定画面に出して、どの版が動いているかを見分けられるようにする。 */
export const BUILD_ID: string = __BUILD_ID__
