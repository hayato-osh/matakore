import type { ReactNode } from 'react'
import { cx } from '../lib/cx'
import styles from './LedgerRow.module.css'

type Props = {
  badge?: ReactNode
  name: ReactNode
  sub?: ReactNode
  right?: ReactNode
  /** 右端の値までを点線で繋ぐ（日付など、名前と対で読ませたいとき） */
  leader?: boolean
  struck?: boolean
  onClick: () => void
}

/**
 * 一覧・未評価・関連記録で共通の行。
 * 縦に読むものなので、印・名前・右端の値の3列を全画面で揃える。
 */
export default function LedgerRow({ badge, name, sub, right, leader, struck, onClick }: Props) {
  return (
    <button type="button" className={styles.row} onClick={onClick}>
      {badge}
      <span className={styles.body}>
        <span className={cx(styles.name, struck && styles.struck)}>{name}</span>
        {sub && <span className={styles.sub}>{sub}</span>}
      </span>
      {right !== undefined && <span className={cx(styles.right, leader && styles.leader)}>{right}</span>}
    </button>
  )
}
