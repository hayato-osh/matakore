import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { IntentBadge, UnratedBadge } from '../components/IntentBadge'
import ProductThumb from '../components/ProductThumb'
import RelatedList from '../components/RelatedList'
import { ScreenHeader } from '../components/ScreenHeader'
import Button from '../components/ui/Button'
import Details from '../components/ui/Details'
import Screen from '../components/ui/Screen'
import { formatCategory } from '../db/categories'
import { getVerdict, recordPurchase } from '../db/repo'
import { cx } from '../lib/cx'
import { formatDate, relativeDays } from '../lib/format'
import { intentMeta } from '../lib/intent'
import { formatJan } from '../lib/jan'
import type { Nav } from '../lib/nav'
import layout from '../styles/layout.module.css'
import text from '../styles/text.module.css'
import styles from './VerdictScreen.module.css'

/**
 * 判定モード（§3.2）。スクロールなしで「買う／やめる」が決まることを最優先にする。
 * データはすべてローカル（IndexedDB）から引く。判定パスにネットワークを入れない。
 */
export default function VerdictScreen({ jan, nav }: { jan: string; nav: Nav }) {
  const verdict = useLiveQuery(() => getVerdict(jan), [jan])
  const [flash, setFlash] = useState('')

  if (!verdict) return <Screen />

  const { product, category, review, purchases, related, sameBrand } = verdict

  const buy = async () => {
    await recordPurchase(jan)
    setFlash(`購入を記録しました（${purchases.length + 1}回目）`)
    setTimeout(() => setFlash(''), 2200)
  }

  return (
    <Screen>
      <ScreenHeader
        title={product?.name ?? '未登録の商品'}
        sub={
          <>
            {product?.brand && <span>{product.brand}</span>}
            {product?.brand && ' / '}
            {formatCategory(category)}
          </>
        }
        onBack={nav.pop}
        action={<ProductThumb src={product?.imageUrl} />}
      />

      <section className={styles.hero}>
        {review ? <IntentBadge intent={review.intent} size="lg" /> : <UnratedBadge size="lg" />}

        <div className={styles.side}>
          <div className={styles.facts}>
            {purchases.length > 0 ? (
              <>
                <span className={text.mono}>{purchases.length}</span> 回購入 ／ 最終{' '}
                <span className={text.mono}>{formatDate(purchases[0].purchasedAt)}</span>
                （{relativeDays(purchases[0].purchasedAt)}）
              </>
            ) : (
              <span>購入記録なし</span>
            )}
          </div>

          {review?.memo && <p className={styles.memo}>「{review.memo}」</p>}

          {!!review?.tags.length && (
            <div className={styles.tags}>
              {review.tags.map((t) => (
                <span key={t} className={styles.tag}>
                  {t}
                </span>
              ))}
            </div>
          )}

          {review && review.history.length > 1 && (
            <p className={cx(text.muted, text.small)}>
              評価の変遷 {review.history.map((h) => intentMeta(h.intent).label).join(' → ')}
            </p>
          )}
        </div>
      </section>

      <div className={layout.actions}>
        <Button variant="primary" size="lg" onClick={() => void buy()}>
          買った
        </Button>
        <Button size="lg" onClick={() => nav.push({ t: 'review', jan })}>
          {review ? '評価を変える' : '評価する'}
        </Button>
      </div>
      {flash && <p className={text.flash}>{flash}</p>}

      <RelatedList title="同カテゴリの記録" entries={related} onSelect={(j) => nav.push({ t: 'verdict', jan: j })} />
      <RelatedList title="同メーカーの記録" entries={sameBrand} onSelect={(j) => nav.push({ t: 'verdict', jan: j })} />

      <footer className={layout.footer}>
        <span className={cx(text.mono, text.muted)}>{formatJan(jan)}</span>
        {product ? (
          <Button variant="ghost" size="sm" onClick={() => nav.push({ t: 'register', jan, edit: true })}>
            商品情報を編集
          </Button>
        ) : (
          <Button size="sm" onClick={() => nav.push({ t: 'register', jan })}>
            この商品を登録
          </Button>
        )}
      </footer>

      {purchases.length > 0 && (
        <Details summary={`購入履歴 ${purchases.length} 件`}>
          <ul className={cx(layout.list, styles.history)}>
            {purchases.map((p) => (
              <li key={p.id}>
                <span className={text.mono}>{formatDate(p.purchasedAt)}</span>
                {p.price !== undefined && <span> ・ {p.price}円</span>}
                {p.store && <span> ・ {p.store}</span>}
              </li>
            ))}
          </ul>
        </Details>
      )}
    </Screen>
  )
}
