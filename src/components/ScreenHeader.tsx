import type { ReactNode } from 'react'
import styles from './ScreenHeader.module.css'

export function ScreenHeader({
  title,
  sub,
  onBack,
  action,
}: {
  title: string
  sub?: ReactNode
  onBack?: () => void
  action?: ReactNode
}) {
  return (
    <header className={styles.header}>
      {onBack && (
        <button type="button" className={styles.back} onClick={onBack} aria-label="戻る">
          ‹
        </button>
      )}
      <div className={styles.text}>
        <h1 className={styles.title}>{title}</h1>
        {sub && <p className={styles.sub}>{sub}</p>}
      </div>
      {action}
    </header>
  )
}
