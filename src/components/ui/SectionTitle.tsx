import type { ReactNode } from 'react'
import styles from './SectionTitle.module.css'

export default function SectionTitle({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <h2 className={styles.title}>
      {children}
      {count !== undefined && <span className={styles.count}>{count}</span>}
    </h2>
  )
}
