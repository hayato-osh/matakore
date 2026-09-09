import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { IntentBadge, UnratedBadge } from '../components/IntentBadge'
import LedgerRow from '../components/LedgerRow'
import { ScreenHeader } from '../components/ScreenHeader'
import { Chip, ChipRow } from '../components/ui/Chip'
import { TextInput } from '../components/ui/Field'
import Screen from '../components/ui/Screen'
import SectionTitle from '../components/ui/SectionTitle'
import { db } from '../db/db'
import { INTENT_RANK } from '../db/repo'
import type { Category, Product, RepeatIntent, Review } from '../db/types'
import { relativeDays } from '../lib/format'
import { INTENTS } from '../lib/intent'
import type { Nav } from '../lib/nav'
import layout from '../styles/layout.module.css'
import text from '../styles/text.module.css'
import styles from './ListScreen.module.css'

type Row = { product: Product; review?: Review; category?: Category; count: number; last?: number }

type Filter = RepeatIntent | 'all' | 'none'

export default function ListScreen({ nav }: { nav: Nav }) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const rows = useLiveQuery(async (): Promise<Row[]> => {
    const [products, reviews, categories, purchases] = await Promise.all([
      db.products.toArray(),
      db.reviews.toArray(),
      db.categories.toArray(),
      db.purchases.toArray(),
    ])
    const reviewBy = new Map(reviews.map((r) => [r.jan, r]))
    const categoryBy = new Map(categories.map((c) => [c.id, c]))
    const stat = new Map<string, { count: number; last: number }>()
    for (const p of purchases) {
      const s = stat.get(p.jan) ?? { count: 0, last: 0 }
      stat.set(p.jan, { count: s.count + 1, last: Math.max(s.last, p.purchasedAt) })
    }
    return products.map((product) => ({
      product,
      review: reviewBy.get(product.jan),
      category: categoryBy.get(product.categoryId),
      count: stat.get(product.jan)?.count ?? 0,
      last: stat.get(product.jan)?.last,
    }))
  }, [], [] as Row[])

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const matched = rows.filter(({ product, review }) => {
      if (filter === 'none' && review) return false
      if (filter !== 'all' && filter !== 'none' && review?.intent !== filter) return false
      if (!needle) return true
      const hay = [product.name, product.brand, product.jan, review?.memo, ...(review?.tags ?? [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(needle)
    })

    const byCategory = new Map<string, Row[]>()
    for (const row of matched) {
      const key = row.category ? `${row.category.major} / ${row.category.minor}` : '未分類'
      byCategory.set(key, [...(byCategory.get(key) ?? []), row])
    }
    return [...byCategory.entries()]
      .map(([title, items]) => ({
        title,
        items: items.sort(
          (a, b) =>
            (a.review ? INTENT_RANK[a.review.intent] : 9) - (b.review ? INTENT_RANK[b.review.intent] : 9) ||
            (b.last ?? 0) - (a.last ?? 0),
        ),
      }))
      .sort((a, b) => a.title.localeCompare(b.title, 'ja'))
  }, [rows, q, filter])

  const total = groups.reduce((n, g) => n + g.items.length, 0)

  return (
    <Screen>
      <ScreenHeader title="一覧" sub={`${total} / ${rows.length} 件`} />

      <TextInput
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="商品名・メーカー・メモ・タグ・JAN"
        type="search"
      />

      <ChipRow wrap>
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
          すべて
        </Chip>
        {INTENTS.map((i) => (
          <Chip key={i.value} active={filter === i.value} onClick={() => setFilter(i.value)}>
            {i.mark} {i.label}
          </Chip>
        ))}
        <Chip active={filter === 'none'} onClick={() => setFilter('none')}>
          未評価
        </Chip>
      </ChipRow>

      {total === 0 ? (
        <p className={text.empty}>該当なし。</p>
      ) : (
        groups.map((g) => (
          <section key={g.title} className={styles.group}>
            <SectionTitle count={g.items.length}>{g.title}</SectionTitle>
            <ul className={layout.list}>
              {g.items.map(({ product, review, count, last }) => (
                <li key={product.jan}>
                  <LedgerRow
                    badge={
                      review ? <IntentBadge intent={review.intent} seed={product.jan} /> : <UnratedBadge />
                    }
                    name={product.name}
                    sub={
                      <>
                        {product.brand && `${product.brand} ・ `}
                        {count > 0 ? `${count}回` : '購入記録なし'}
                        {review?.memo && ` ・ ${review.memo}`}
                      </>
                    }
                    right={last ? relativeDays(last) : ''}
                    leader={!!last}
                    struck={review?.intent === 'no'}
                    onClick={() => nav.push({ t: 'verdict', jan: product.jan })}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </Screen>
  )
}
