import { useEffect, useState } from 'react'
import CategoryPicker from '../components/CategoryPicker'
import RelatedList from '../components/RelatedList'
import { ScreenHeader } from '../components/ScreenHeader'
import Button from '../components/ui/Button'
import Details from '../components/ui/Details'
import { Label, TextInput } from '../components/ui/Field'
import Screen from '../components/ui/Screen'
import { UNCATEGORIZED_ID } from '../db/categories'
import { db } from '../db/db'
import { deleteProductCascade, recordPurchase, relatedByCategory, upsertProduct, type RelatedEntry } from '../db/repo'
import { cx } from '../lib/cx'
import { formatJan } from '../lib/jan'
import type { Nav } from '../lib/nav'
import { normalizeProductName } from '../lib/normalize'
import layout from '../styles/layout.module.css'
import text from '../styles/text.module.css'

/**
 * Phase 0 の商品登録は手入力（§8）。ここで詰まらせないことが最優先で、
 * 必須は商品名だけ。カテゴリは直前に使ったものを初期選択して1タップも減らす。
 */
export default function RegisterScreen({ jan, edit, nav }: { jan: string; edit: boolean; nav: Nav }) {
  const [loaded, setLoaded] = useState(false)
  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [price, setPrice] = useState('')
  const [store, setStore] = useState('')
  const [related, setRelated] = useState<RelatedEntry[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    const load = async () => {
      const existing = await db.products.get(jan)
      if (!alive) return
      if (existing) {
        setName(existing.name)
        setBrand(existing.brand ?? '')
        setCategoryId(existing.categoryId)
      } else {
        const last = await db.products.orderBy('fetchedAt').last()
        if (alive) setCategoryId(last?.categoryId ?? UNCATEGORIZED_ID)
      }
      if (alive) setLoaded(true)
    }
    void load()
    return () => {
      alive = false
    }
  }, [jan])

  // 選んだカテゴリの過去評価をその場で出す。登録の途中でも「このカテゴリは全部微妙だった」が見える。
  useEffect(() => {
    let alive = true
    if (!categoryId) return
    void relatedByCategory(categoryId, jan).then((r) => {
      if (alive) setRelated(r)
    })
    return () => {
      alive = false
    }
  }, [categoryId, jan])

  const normalized = normalizeProductName(name)
  const willNormalize = loaded && name.trim().length > 0 && normalized !== name.trim()

  const save = async (alsoBuy: boolean) => {
    if (!normalized.trim() || saving) return
    setSaving(true)
    try {
      await upsertProduct({
        jan,
        name: normalized,
        rawName: normalized !== name.trim() ? name.trim() : undefined,
        brand: brand.trim(),
        categoryId: categoryId || UNCATEGORIZED_ID,
      })
      if (alsoBuy) {
        const parsed = Number(price)
        await recordPurchase(jan, {
          price: price.trim() && Number.isFinite(parsed) ? parsed : undefined,
          store: store.trim(),
        })
      }
      if (edit) nav.pop()
      else nav.replace({ t: 'verdict', jan })
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!confirm('この商品の評価と購入履歴もまとめて削除します。よろしいですか？')) return
    await deleteProductCascade(jan)
    nav.pop()
  }

  return (
    <Screen>
      <ScreenHeader
        title={edit ? '商品情報を編集' : '新しい商品'}
        sub={<span className={text.mono}>{formatJan(jan)}</span>}
        onBack={nav.pop}
      />

      <Label htmlFor="name">商品名</Label>
      <TextInput
        id="name"
        size="lg"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="こくまろカレー 中辛"
        autoFocus={!edit}
        enterKeyHint="done"
      />
      {willNormalize && (
        <p className={cx(text.muted, text.small)}>保存時: {normalized}（元の表記は rawName に残す）</p>
      )}

      <Label htmlFor="brand">メーカー（任意）</Label>
      <TextInput
        id="brand"
        value={brand}
        onChange={(e) => setBrand(e.target.value)}
        placeholder="ハウス食品"
      />

      <Label>カテゴリ</Label>
      <CategoryPicker value={categoryId} onChange={setCategoryId} />

      {!edit && (
        <Details summary="価格・店舗を記録する（任意）">
          <div className={layout.row}>
            <TextInput
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="numeric"
              placeholder="価格"
            />
            <TextInput value={store} onChange={(e) => setStore(e.target.value)} placeholder="店舗" />
          </div>
        </Details>
      )}

      <div className={layout.actions}>
        {edit ? (
          <Button variant="primary" size="lg" disabled={!normalized || saving} onClick={() => void save(false)}>
            保存
          </Button>
        ) : (
          <>
            <Button variant="primary" size="lg" disabled={!normalized || saving} onClick={() => void save(true)}>
              登録して購入を記録
            </Button>
            <Button size="lg" disabled={!normalized || saving} onClick={() => void save(false)}>
              登録だけ
            </Button>
          </>
        )}
      </div>

      <RelatedList
        title="このカテゴリの記録"
        entries={related}
        onSelect={(j) => nav.push({ t: 'verdict', jan: j })}
      />

      {edit && (
        <footer className={layout.footer}>
          <Button variant="danger" size="sm" onClick={() => void remove()}>
            この商品を削除
          </Button>
        </footer>
      )}
    </Screen>
  )
}
