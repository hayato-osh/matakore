import { useEffect, useState } from 'react'
import { ScreenHeader } from '../components/ScreenHeader'
import Button from '../components/ui/Button'
import { Label, TextInput } from '../components/ui/Field'
import Screen from '../components/ui/Screen'
import { db } from '../db/db'
import { deleteReview, saveReview } from '../db/repo'
import type { RepeatIntent } from '../db/types'
import { cx } from '../lib/cx'
import { parseTags } from '../lib/format'
import { INTENTS } from '../lib/intent'
import type { Nav } from '../lib/nav'
import layout from '../styles/layout.module.css'
import text from '../styles/text.module.css'
import styles from './ReviewScreen.module.css'

/**
 * Phase B「評価」（§3.1）。メモとタグは任意で、intent のタップがそのまま保存と離脱を兼ねる。
 * 星は主軸にしない（§3.3）ので、開いた時点では畳んでおく。
 */
export default function ReviewScreen({ jan, nav }: { jan: string; nav: Nav }) {
  const [name, setName] = useState('')
  const [memo, setMemo] = useState('')
  const [tagText, setTagText] = useState('')
  const [stars, setStars] = useState<number | undefined>(undefined)
  const [showStars, setShowStars] = useState(false)
  const [current, setCurrent] = useState<RepeatIntent | undefined>(undefined)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    const load = async () => {
      const [product, review] = await Promise.all([db.products.get(jan), db.reviews.get(jan)])
      if (!alive) return
      setName(product?.name ?? jan)
      if (review) {
        setMemo(review.memo ?? '')
        setTagText(review.tags.join(' '))
        setStars(review.stars)
        setShowStars(review.stars !== undefined)
        setCurrent(review.intent)
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [jan])

  const pick = async (intent: RepeatIntent) => {
    if (saving) return
    setSaving(true)
    try {
      await saveReview(jan, { intent, memo, tags: parseTags(tagText), stars })
      nav.pop()
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    await deleteReview(jan)
    nav.pop()
  }

  return (
    <Screen>
      <ScreenHeader title={name} sub="また買う？" onBack={nav.pop} />

      <Label htmlFor="memo">一行メモ（任意・未来の自分への申し送り）</Label>
      <TextInput
        id="memo"
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        placeholder="甘めだけど子供っぽくない。常備でいい"
        maxLength={120}
      />

      <Label htmlFor="tags">タグ（任意・スペース区切り）</Label>
      <TextInput
        id="tags"
        value={tagText}
        onChange={(e) => setTagText(e.target.value)}
        placeholder="辛い 常備 子供受け"
      />

      <div className={styles.grid}>
        {INTENTS.map((i) => (
          <button
            key={i.value}
            type="button"
            className={cx(styles.stamp, styles[i.value], current === i.value && styles.current)}
            disabled={saving}
            onClick={() => void pick(i.value)}
          >
            <span className={styles.mark}>{i.mark}</span>
            <span className={styles.label}>{i.label}</span>
            <span className={styles.hint}>{i.hint}</span>
          </button>
        ))}
      </div>

      {showStars ? (
        <div className={cx(layout.row, styles.stars)}>
          <span className={cx(text.muted, text.small)}>星</span>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              className={cx(styles.star, stars !== undefined && n <= stars && styles.starOn)}
              onClick={() => setStars(stars === n ? undefined : n)}
              aria-label={`星${n}`}
            >
              ★
            </button>
          ))}
        </div>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setShowStars(true)}>
          星をつける（任意）
        </Button>
      )}

      {current && (
        <footer className={layout.footer}>
          <Button variant="danger" size="sm" onClick={() => void remove()}>
            評価を削除
          </Button>
        </footer>
      )}
    </Screen>
  )
}
