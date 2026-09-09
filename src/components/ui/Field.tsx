import type { InputHTMLAttributes, ReactNode } from 'react'
import { cx } from '../../lib/cx'
import styles from './Field.module.css'

export function Label({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return (
    <label className={styles.label} htmlFor={htmlFor}>
      {children}
    </label>
  )
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  size?: 'md' | 'lg'
  mono?: boolean
}

export function TextInput({ size = 'md', mono, className, ...rest }: InputProps) {
  return <input className={cx(styles.input, size === 'lg' && styles.lg, mono && styles.mono, className)} {...rest} />
}
