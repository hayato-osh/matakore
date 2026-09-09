import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from '../../lib/cx'
import styles from './Chip.module.css'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean
  tone?: 'default' | 'minor' | 'add'
}

export function Chip({ active, tone = 'default', className, ...rest }: Props) {
  return (
    <button
      type="button"
      className={cx(styles.chip, active && styles.active, tone !== 'default' && styles[tone], className)}
      {...rest}
    />
  )
}

/** 札を横に並べる。wrap を立てると折り返し、立てないと横スクロールになる。 */
export function ChipRow({ children, wrap }: { children: ReactNode; wrap?: boolean }) {
  return <div className={cx(styles.row, wrap && styles.wrap)}>{children}</div>
}
