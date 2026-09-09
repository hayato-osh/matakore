import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'
import styles from './App.module.css'
import TabIcon, { type IconName } from './components/TabIcon'
import { db } from './db/db'
import { cx } from './lib/cx'
import { useNav, type Tab } from './lib/nav'
import { applyTheme, getTheme } from './lib/theme'
import ListScreen from './screens/ListScreen'
import QueueScreen from './screens/QueueScreen'
import RegisterScreen from './screens/RegisterScreen'
import ReviewScreen from './screens/ReviewScreen'
import ScanScreen from './screens/ScanScreen'
import SettingsScreen from './screens/SettingsScreen'
import VerdictScreen from './screens/VerdictScreen'

const TABS: { tab: Tab; label: string; icon: IconName }[] = [
  { tab: 'scan', label: 'スキャン', icon: 'scan' },
  { tab: 'queue', label: '未評価', icon: 'queue' },
  { tab: 'list', label: '一覧', icon: 'list' },
  { tab: 'settings', label: '設定', icon: 'settings' },
]

export default function App() {
  const nav = useNav()
  const view = nav.view

  // 「自動」のときは OS 側の切り替えに追従する
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme(getTheme())
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // 未評価バッジ。催促はこの数字だけに留める（溜まっても構わない設計 §3.1）。
  const unreviewed = useLiveQuery(async () => {
    const [products, reviews] = await Promise.all([db.products.count(), db.reviews.count()])
    return Math.max(0, products - reviews)
  }, [])

  const activeTab: Tab =
    view.t === 'queue' || view.t === 'review'
      ? 'queue'
      : view.t === 'list'
        ? 'list'
        : view.t === 'settings'
          ? 'settings'
          : 'scan'

  return (
    <div className={styles.app}>
      <div className={styles.grain} aria-hidden />
      <main className={styles.main}>
        {view.t === 'scan' && <ScanScreen nav={nav} />}
        {view.t === 'queue' && <QueueScreen nav={nav} />}
        {view.t === 'list' && <ListScreen nav={nav} />}
        {view.t === 'settings' && <SettingsScreen />}
        {view.t === 'verdict' && <VerdictScreen key={view.jan} jan={view.jan} nav={nav} />}
        {view.t === 'register' && (
          <RegisterScreen key={view.jan} jan={view.jan} edit={view.edit ?? false} nav={nav} />
        )}
        {view.t === 'review' && <ReviewScreen key={view.jan} jan={view.jan} nav={nav} />}
      </main>

      <nav className={styles.tabbar}>
        {TABS.map((t) => (
          <button
            key={t.tab}
            type="button"
            className={cx(styles.tab, activeTab === t.tab && styles.active)}
            onClick={() => nav.switchTab(t.tab)}
          >
            <TabIcon name={t.icon} />
            <span className={styles.label}>{t.label}</span>
            {t.tab === 'queue' && !!unreviewed && <span className={styles.badge}>{unreviewed}</span>}
          </button>
        ))}
      </nav>
    </div>
  )
}
