import type { RelatedEntry } from '../db/repo'
import { relativeDays } from '../lib/format'
import layout from '../styles/layout.module.css'
import text from '../styles/text.module.css'
import { cx } from '../lib/cx'
import { IntentBadge } from './IntentBadge'
import LedgerRow from './LedgerRow'
import SectionTitle from './ui/SectionTitle'

/**
 * 同カテゴリ／同メーカーの過去評価。
 * 未登録商品でも「このメーカーのパスタソースは2回とも微妙だった」と判断できるようにするための面（§3.2）。
 */
export default function RelatedList({
  title,
  entries,
  onSelect,
  limit = 6,
}: {
  title: string
  entries: RelatedEntry[]
  onSelect: (jan: string) => void
  limit?: number
}) {
  if (entries.length === 0) return null
  return (
    <section>
      <SectionTitle count={entries.length}>{title}</SectionTitle>
      <ul className={layout.list}>
        {entries.slice(0, limit).map(({ product, review }) => (
          <li key={product.jan}>
            <LedgerRow
              badge={<IntentBadge intent={review.intent} seed={product.jan} />}
              name={product.name}
              sub={review.memo}
              right={relativeDays(review.updatedAt)}
              leader
              struck={review.intent === 'no'}
              onClick={() => onSelect(product.jan)}
            />
          </li>
        ))}
      </ul>
      {entries.length > limit && (
        <p className={cx(text.muted, text.small)}>ほか {entries.length - limit} 件</p>
      )}
    </section>
  )
}
