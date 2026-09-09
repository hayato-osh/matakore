import type { ButtonHTMLAttributes } from 'react'
import { cx } from '../../lib/cx'
import styles from './Button.module.css'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  size?: 'md' | 'lg' | 'sm'
}

export default function Button({ variant = 'default', size = 'md', className, ...rest }: Props) {
  return (
    <button
      type="button"
      className={cx(
        styles.btn,
        variant !== 'default' && styles[variant],
        size !== 'md' && styles[size],
        className,
      )}
      {...rest}
    />
  )
}
