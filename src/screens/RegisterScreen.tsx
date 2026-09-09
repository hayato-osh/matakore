import { useEffect, useState } from 'react'
import CategoryPicker from '../components/CategoryPicker'
import ProductThumb from '../components/ProductThumb'
import RelatedList from '../components/RelatedList'
import { ScreenHeader } from '../components/ScreenHeader'
import Button from '../components/ui/Button'
import Details from '../components/ui/Details'
import { Label, TextInput } from '../components/ui/Field'
import Screen from '../components/ui/Screen'
import { UNCATEGORIZED_ID } from '../db/categories'
import { db } from '../db/db'
import { deleteProductCascade, recordPurchase, relatedByCategory, upsertProduct, type RelatedEntry } from '../db/repo'
import { suggestCategory } from '../lib/classify'
import { cx } from '../lib/cx'
import { formatJan } from '../lib/jan'
import type { Nav } from '../lib/nav'
import { splitProduct } from '../lib/normalize'
import { relogin, resolveJan, SOURCE_LABEL, type ResolvedProduct, type ResolveResult } from '../lib/resolver'
import layout from '../styles/layout.module.css'
import text from '../styles/text.module.css'
import styles from './RegisterScreen.module.css'

type Lookup = { status: 'idle' | 'loading' } | ResolveResult

const lookupNote = (l: Lookup): string => {
  switch (l.status) {
    case 'loading':
      return '商品名を探しています…'
    case 'found':
      return `${SOURCE_LABEL[l.product.source]}から取得しました。違っていれば書き直せます`
    case 'notfound':
      return 'どのソースにも無かったので手入力してください'
    case 'offline':
      return '圏外のため手入力。商品名は後から編集できます'
    case 'login':
      return 'ログインが切れているため手入力。開き直せば自動で引けます'
    case 'error':
      return `取得に失敗しました（${l.message}）。手入力してください`
    default:
      return ''
  }
}

/**
 * 商品登録。Phase 1 で JAN 解決が入ったが、必須が商品名だけなのは変わらない。
 * 解決を待っている間も入力できる。解決結果は名前が空のときにだけ流し込み、打ち始めた手を止めない。
 * カテゴリの自動提案は必ず1タップの承認を挟む（§5.1）。勝手に確定しない。
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
  const [lookup, setLookup] = useState<Lookup>({ status: 'idle' })
  const [resolved, setResolved] = useState<ResolvedProduct | undefined>()
  const [dismissedSuggestion, setDismissedSuggestion] = useState('')

  useEffect(() => {
    let alive = true
    const load = async () => {
      const existing = await db.products.get(jan)
      if (!alive) return
      if (existing) {
        setName(existing.name)
        setBrand(existing.brand ?? '')
        setCategoryId(existing.categoryId)
        setLoaded(true)
        return
      }
      const last = await db.products.orderBy('fetchedAt').last()
      if (!alive) return
      setCategoryId(last?.categoryId ?? UNCATEGORIZED_ID)
      setLoaded(true)

      // 未知の JAN だけ外部に聞く。判定パス（VerdictScreen）からは絶対に呼ばない。
      setLookup({ status: 'loading' })
      const result = await resolveJan(jan)
      if (!alive) return
      setLookup(result)
      if (result.status === 'found') {
        setResolved(result.product)
        // 欄には正規化した名前とメーカーを入れる。生の出品タイトルは rawName として別に保存されるので、ここで見せる必要はない。
        // EC の brand 欄はシリーズ名のことが多いので、タイトル中のメーカー名を辞書で拾って優先する。
        // ユーザーが既に打ち始めていたら上書きしない
        const split = splitProduct(result.product.rawName, result.product.brand)
        setName((n) => n.trim() || split.name)
        setBrand((b) => b.trim() || split.brand || '')
      }
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

  // 手入力でも同じ正規化を通す。「ハウス こくまろカレー」と打てば名前は「こくまろカレー」、メーカーは「ハウス食品」になる
  const split = splitProduct(name, brand)
  const normalized = split.name
  const effectiveBrand = brand.trim() || split.brand || ''
  const willNormalize = loaded && name.trim().length > 0 && (normalized !== name.trim() || effectiveBrand !== brand.trim())

  const suggestion = suggestCategory(name, effectiveBrand)
  const showSuggestion = !!suggestion && suggestion !== categoryId && suggestion !== dismissedSuggestion

  const save = async (alsoBuy: boolean) => {
    if (!normalized.trim() || saving) return
    setSaving(true)
    try {
      await upsertProduct({
        jan,
        name: normalized,
        // API 由来なら生データを必ず残す。手入力なら正規化で変わったときだけ元の表記を残す
        rawName: resolved?.rawName ?? (normalized !== name.trim() ? name.trim() : undefined),
        brand: effectiveBrand,
        categoryId: categoryId || UNCATEGORIZED_ID,
        imageUrl: resolved?.imageUrl,
        source: resolved?.source,
        fetchedAt: resolved?.fetchedAt,
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

  const note = lookupNote(lookup)

  return (
    <Screen>
      <ScreenHeader
        title={edit ? '商品情報を編集' : '新しい商品'}
        sub={<span className={text.mono}>{formatJan(jan)}</span>}
        onBack={nav.pop}
        action={<ProductThumb src={resolved?.imageUrl} size="lg" />}
      />

      <Label htmlFor="name">商品名</Label>
      <TextInput
        id="name"
        size="lg"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={lookup.status === 'loading' ? '' : 'こくまろカレー 中辛'}
        autoFocus={!edit}
        enterKeyHint="done"
      />
      {note && (
        <p className={cx(text.small, lookup.status === 'loading' ? text.muted : styles.note)} aria-live="polite">
          {note}
          {lookup.status === 'login' && (
            <>
              {' '}
              <button type="button" className={styles.link} onClick={relogin}>
                開き直す
              </button>
            </>
          )}
        </p>
      )}
      {willNormalize && (
        <p className={cx(text.muted, text.small)}>
          保存時: {normalized}
          {effectiveBrand && ` ／ ${effectiveBrand}`}（元の表記は rawName に残す）
        </p>
      )}

      <Label htmlFor="brand">メーカー（任意）</Label>
      <TextInput
        id="brand"
        value={brand}
        onChange={(e) => setBrand(e.target.value)}
        placeholder="ハウス食品"
      />

      <Label>カテゴリ</Label>
      {showSuggestion && (
        <div className={styles.suggest}>
          <span className={styles.suggestText}>
            分類の提案 <strong>{suggestion.replace('/', ' / ')}</strong>
          </span>
          <Button size="sm" onClick={() => setCategoryId(suggestion)}>
            これにする
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDismissedSuggestion(suggestion)}>
            違う
          </Button>
        </div>
      )}
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
