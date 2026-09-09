import { useCallback, useEffect, useState } from 'react'

export type Tab = 'scan' | 'queue' | 'list' | 'settings'

export type View =
  | { t: 'scan' }
  | { t: 'queue' }
  | { t: 'list' }
  | { t: 'settings' }
  | { t: 'verdict'; jan: string }
  | { t: 'register'; jan: string; edit?: boolean }
  | { t: 'review'; jan: string }

/**
 * ルーターは入れない。画面数が少なく、URL を共有する相手もいない（単一ユーザー前提）。
 * ただし Android の戻るボタンだけは効かせたいので History API には乗せる。
 */
export const useNav = () => {
  const [stack, setStack] = useState<View[]>([{ t: 'scan' }])

  useEffect(() => {
    const onPop = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const push = useCallback((view: View) => {
    history.pushState({ matakore: true }, '')
    setStack((s) => [...s, view])
  }, [])

  const pop = useCallback(() => {
    // popstate ハンドラ側で stack を削るので、ここでは履歴を戻すだけ
    history.back()
  }, [])

  /** タブ切り替えはスタックを捨てる。深い階層から戻る導線はタブそのもの。 */
  const switchTab = useCallback((tab: Tab) => setStack([{ t: tab }]), [])

  /** 登録 → 判定 のように、戻り先に残したくない画面を差し替える。 */
  const replace = useCallback((view: View) => setStack((s) => [...s.slice(0, -1), view]), [])

  return { view: stack[stack.length - 1], depth: stack.length, push, pop, replace, switchTab }
}

export type Nav = ReturnType<typeof useNav>
