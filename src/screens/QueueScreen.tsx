import { useLiveQuery } from 'dexie-react-hooks'
import LedgerRow from '../components/LedgerRow'
import { ScreenHeader } from '../components/ScreenHeader'
import Screen from '../components/ui/Screen'
import { unreviewedQueue } from '../db/repo'
import { relativeDays } from '../lib/format'
import type { Nav } from '../lib/nav'
import layout from '../styles/layout.module.css'
import text from '../styles/text.module.css'
import styles from './QueueScreen.module.css'

/** 未評価キュー。溜まっても構わない設計なので、責める文言は置かない（§3.1）。 */
export default function QueueScreen({ nav }: { nav: Nav }) {
  const queue = useLiveQuery(() => unreviewedQueue(), [], [])

  return (
    <Screen>
      <ScreenHeader title="未評価" sub={queue.length ? `${queue.length}件たまっています` : undefined} />

      {queue.length === 0 ? (
        <p className={text.empty}>未評価はありません。食べたら評価しましょう。</p>
      ) : (
        <ul className={layout.list}>
          {queue.map(({ product, lastPurchasedAt, purchaseCount }) => (
            <li key={product.jan}>
              <LedgerRow
                name={product.name}
                sub={
                  <>
                    {product.brand && `${product.brand} ・ `}
                    {lastPurchasedAt ? `${relativeDays(lastPurchasedAt)}に購入` : '購入記録なし'}
                    {purchaseCount > 1 && ` ・ ${purchaseCount}回`}
                  </>
                }
                right={<span className={styles.cta}>評価</span>}
                onClick={() => nav.push({ t: 'review', jan: product.jan })}
              />
            </li>
          ))}
        </ul>
      )}
    </Screen>
  )
}
