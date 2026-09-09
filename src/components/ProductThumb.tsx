import { useState } from 'react'
import styles from './ProductThumb.module.css'

/**
 * 外部API由来の商品画像。オフラインでは落ちるので、読めなければ黙って消える。
 * 判定の主役は印であって写真ではないので、寸法は小さく固定する。
 */
export default function ProductThumb({ src, size = 'md' }: { src?: string; size?: 'md' | 'lg' }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return null
  return (
    <img
      className={size === 'lg' ? styles.lg : styles.md}
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}
