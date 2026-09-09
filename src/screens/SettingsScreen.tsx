import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { ScreenHeader } from '../components/ScreenHeader'
import Button from '../components/ui/Button'
import { Chip, ChipRow } from '../components/ui/Chip'
import Screen from '../components/ui/Screen'
import SectionTitle from '../components/ui/SectionTitle'
import { db } from '../db/db'
import { buildBackup, buildPurchasesCsv, buildReviewsCsv, download, importBackup, wipeAll } from '../db/export'
import { stats } from '../db/repo'
import { cx } from '../lib/cx'
import { formatDate } from '../lib/format'
import { checkResolver, relogin, SOURCE_LABEL } from '../lib/resolver'
import { BUILD_ID, checkForUpdate } from '../lib/sw'
import { getTheme, setTheme, THEMES, type Theme } from '../lib/theme'
import layout from '../styles/layout.module.css'
import text from '../styles/text.module.css'
import styles from './SettingsScreen.module.css'

const stamp = () => formatDate(Date.now())

export default function SettingsScreen() {
  const s = useLiveQuery(() => stats(), [])
  const fileRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState('')
  const [theme, setThemeState] = useState<Theme>(getTheme)
  const pickTheme = (next: Theme) => {
    setTheme(next)
    setThemeState(next)
  }

  const [updateStatus, setUpdateStatus] = useState('')

  const update = async () => {
    setUpdateStatus('確認中…')
    const r = await checkForUpdate()
    setUpdateStatus(
      r === 'updating'
        ? '新しい版を取り込んでいます。数秒で再読み込みされます'
        : r === 'latest'
          ? 'この版が最新です'
          : r === 'offline'
            ? '圏外のため確認できません'
            : 'このブラウザでは更新確認を使えません',
    )
  }

  const [resolverStatus, setResolverStatus] = useState('')
  const [needLogin, setNeedLogin] = useState(false)

  const testResolver = async () => {
    setResolverStatus('確認中…')
    setNeedLogin(false)
    const r = await checkResolver()
    if (r.ok) {
      const sources = r.sources.map((s) => SOURCE_LABEL[s as keyof typeof SOURCE_LABEL] ?? s).join(' / ')
      setResolverStatus(`接続OK${r.user ? `（${r.user}）` : ''}。有効なソース: ${sources}`)
    } else {
      setResolverStatus(`接続できません: ${r.message}`)
      setNeedLogin(r.message.includes('ログイン'))
    }
  }

  const exportAll = async () => {
    download(`matakore-backup-${stamp()}.json`, JSON.stringify(await buildBackup(), null, 2), 'application/json')
  }

  const exportReviewsJson = async () => {
    // 評価だけを切り出す。マスタは再取得できるが評価は代替不能なので、単体で持ち出せるようにしておく（§5）。
    const reviews = await db.reviews.toArray()
    download(
      `matakore-reviews-${stamp()}.json`,
      JSON.stringify({ app: 'matakore', version: 1, exportedAt: Date.now(), reviews }, null, 2),
      'application/json',
    )
  }

  const importFile = async (file: File) => {
    try {
      const result = await importBackup(await file.text())
      setMessage(
        `取り込み完了: 商品 ${result.products} / 購入 ${result.purchases} / 評価 ${result.reviews} / カテゴリ ${result.categories}`,
      )
    } catch (e) {
      setMessage(`取り込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const wipe = async () => {
    if (!confirm('すべてのデータを削除します。先にエクスポートしましたか？')) return
    if (!confirm('本当に削除します。元に戻せません。')) return
    await wipeAll()
    location.reload()
  }

  return (
    <Screen>
      <ScreenHeader title="設定" />

      <section className={styles.card}>
        <SectionTitle>表示</SectionTitle>
        <ChipRow>
          {THEMES.map((t) => (
            <Chip key={t.value} active={theme === t.value} onClick={() => pickTheme(t.value)}>
              {t.label}
            </Chip>
          ))}
        </ChipRow>
        <p className={cx(text.muted, text.small)}>
          「自動」は端末の設定に従う。夜の売り場と昼の台所で明るさが違うため。
        </p>
      </section>

      <section className={styles.card}>
        <SectionTitle>データ</SectionTitle>
        <dl className={styles.stats}>
          <div>
            <dt>商品</dt>
            <dd>{s?.products ?? '-'}</dd>
          </div>
          <div>
            <dt>購入</dt>
            <dd>{s?.purchases ?? '-'}</dd>
          </div>
          <div>
            <dt>評価</dt>
            <dd>{s?.reviews ?? '-'}</dd>
          </div>
          <div>
            <dt>未評価</dt>
            <dd>{s?.unreviewed ?? '-'}</dd>
          </div>
        </dl>
        <p className={cx(text.muted, text.small)}>
          記録100件で集計、300件で嗜好プロファイル、500件で類似商品推薦に着手できる（DESIGN §7）。
        </p>
      </section>

      <section className={styles.card}>
        <SectionTitle>商品マスタ解決</SectionTitle>
        <p className={cx(text.muted, text.small)}>
          未知の JAN を読んだとき、同じ Worker の /api 経由で Yahoo!／楽天／Open Food Facts から商品名を引く。
          認証は Cloudflare Access（このアプリを開いたときのログイン）に任せていて、ここで入れるものは無い。
          判定はこれが無くても動く（ローカルだけで完結する）。
        </p>
        <div className={layout.actions}>
          <Button onClick={() => void testResolver()}>接続を確認</Button>
          {needLogin && (
            <Button variant="primary" onClick={relogin}>
              ログインし直す
            </Button>
          )}
        </div>
        {resolverStatus && <p className={cx(text.small, text.muted)}>{resolverStatus}</p>}
      </section>

      <section className={styles.card}>
        <SectionTitle>エクスポート</SectionTitle>
        <div className={layout.stack}>
          <Button onClick={() => void exportAll()}>完全バックアップ（JSON）</Button>
          <Button onClick={() => void exportReviewsJson()}>評価のみ（JSON）</Button>
          <Button
            onClick={() =>
              void buildReviewsCsv().then((c) => download(`matakore-reviews-${stamp()}.csv`, c, 'text/csv'))
            }
          >
            評価（CSV）
          </Button>
          <Button
            onClick={() =>
              void buildPurchasesCsv().then((c) => download(`matakore-purchases-${stamp()}.csv`, c, 'text/csv'))
            }
          >
            購入履歴（CSV）
          </Button>
        </div>
      </section>

      <section className={styles.card}>
        <SectionTitle>インポート</SectionTitle>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void importFile(file)
            e.target.value = ''
          }}
        />
        <Button onClick={() => fileRef.current?.click()}>完全バックアップを読み込む</Button>
        <p className={cx(text.muted, text.small)}>同じ JAN / ID のレコードは上書きされます。</p>
        {message && <p className={text.flash}>{message}</p>}
      </section>

      <section className={styles.card}>
        <SectionTitle>危険な操作</SectionTitle>
        <Button variant="danger" onClick={() => void wipe()}>
          すべてのデータを削除
        </Button>
      </section>

      <section className={styles.card}>
        <SectionTitle>アプリの版</SectionTitle>
        <p className={cx(text.muted, text.small)}>
          ビルド <span className={text.mono}>{BUILD_ID}</span>。ホーム画面のアプリは古い版が残りやすいので、
          表示がおかしいときはここから更新する。起動時と1時間ごとにも自動で確認している。
        </p>
        <Button onClick={() => void update()}>更新を確認</Button>
        {updateStatus && <p className={cx(text.small, text.muted)}>{updateStatus}</p>}
      </section>

      <p className={cx(text.muted, text.small, styles.version)}>
        matakore — Phase 1（JAN 解決は Workers 経由・判定はローカル完結）
      </p>
    </Screen>
  )
}
