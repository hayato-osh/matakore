import type { CSSProperties } from 'react'
import type { RepeatIntent } from '../db/types'
import { cx } from '../lib/cx'
import { intentMeta } from '../lib/intent'
import styles from './IntentBadge.module.css'

/**
 * 判定は「押された印」として見せる。
 * 手で押した印は少しずつ傾くので、JAN から決まる範囲の傾きを与える。
 * 乱数にすると再描画のたびに揺れてノイズになるため、必ず seed から決める。
 */
const tiltOf = (seed?: string) => {
  if (!seed) return '0deg'
  let h = 7
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 9973
  return `${(h % 9) - 4}deg`
}

type Props = { intent: RepeatIntent; size?: 'sm' | 'lg'; seed?: string }

export function IntentBadge({ intent, size = 'sm', seed }: Props) {
  const meta = intentMeta(intent)
  return (
    <span
      className={cx(styles.seal, styles[size], styles[intent])}
      style={{ '--tilt': tiltOf(seed) } as CSSProperties}
      aria-label={meta.label}
    >
      <span className={styles.mark}>{meta.mark}</span>
      {/* 一覧の行では語を出さない。◎○△✕ だけで読めるうえ、商品名に幅を渡した方が速い */}
      {size === 'lg' && <span className={styles.word}>{meta.label}</span>}
    </span>
  )
}

/** まだ印が押されていない状態。空欄であることを見せる。 */
export function UnratedBadge({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    <span className={cx(styles.seal, styles[size], styles.none)} aria-label="未評価">
      <span className={styles.mark}>未</span>
      {size === 'lg' && <span className={styles.word}>未評価</span>}
    </span>
  )
}
