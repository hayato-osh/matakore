import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'
import styles from './Screen.module.css'

export default function Screen({ children, bleed }: { children?: ReactNode; bleed?: boolean }) {
  return <div className={cx(styles.screen, bleed && styles.bleed)}>{children}</div>
}
