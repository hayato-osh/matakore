import type { ReactNode } from 'react'
import styles from './Details.module.css'

export default function Details({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return (
    <details className={styles.details}>
      <summary>{summary}</summary>
      {children}
    </details>
  )
}
