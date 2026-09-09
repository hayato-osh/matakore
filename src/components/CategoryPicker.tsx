import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { MAJORS, categoryId } from '../db/categories'
import { db } from '../db/db'
import type { MajorCategory } from '../db/types'
import layout from '../styles/layout.module.css'
import Button from './ui/Button'
import { Chip, ChipRow } from './ui/Chip'
import { TextInput } from './ui/Field'
import styles from './CategoryPicker.module.css'

/**
 * 2階層固定（§5.1）。大分類を選ぶと中分類が絞られる。
 * 中分類が足りないときはその場で足せるようにする。分類に迷って入力が止まるのが一番まずい。
 */
export default function CategoryPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (categoryId: string) => void
}) {
  const categories = useLiveQuery(() => db.categories.toArray(), [], [])
  const current = categories.find((c) => c.id === value)
  const [major, setMajor] = useState<MajorCategory>(current?.major ?? '食品')
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  // value が後から入ってきた場合（編集時）に大分類を合わせる
  const shownMajor = current && current.major !== major && !adding ? current.major : major

  const minors = categories
    .filter((c) => c.major === shownMajor)
    .sort((a, b) => (a.minor === 'その他' ? 1 : b.minor === 'その他' ? -1 : a.minor.localeCompare(b.minor, 'ja')))

  const addMinor = async () => {
    const minor = draft.trim()
    if (!minor) return
    const id = categoryId(shownMajor, minor)
    await db.categories.put({ id, major: shownMajor, minor })
    onChange(id)
    setDraft('')
    setAdding(false)
  }

  return (
    <div className={styles.picker}>
      <ChipRow>
        {MAJORS.map((m) => (
          <Chip
            key={m}
            active={shownMajor === m}
            onClick={() => {
              setMajor(m)
              setAdding(false)
            }}
          >
            {m}
          </Chip>
        ))}
      </ChipRow>
      <ChipRow wrap>
        {minors.map((c) => (
          <Chip key={c.id} tone="minor" active={value === c.id} onClick={() => onChange(c.id)}>
            {c.minor}
          </Chip>
        ))}
        {!adding && (
          <Chip tone="add" onClick={() => setAdding(true)}>
            ＋ 追加
          </Chip>
        )}
      </ChipRow>
      {adding && (
        <div className={layout.row}>
          <TextInput
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`${shownMajor} の中分類を追加`}
            autoFocus
          />
          <Button size="sm" onClick={() => void addMinor()}>
            追加
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
            やめる
          </Button>
        </div>
      )}
    </div>
  )
}
