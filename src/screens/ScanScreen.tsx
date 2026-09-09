import { useState } from 'react'
import CameraScanner from '../components/CameraScanner'
import Button from '../components/ui/Button'
import { Label, TextInput } from '../components/ui/Field'
import Screen from '../components/ui/Screen'
import { db } from '../db/db'
import { primeAudio } from '../lib/feedback'
import { isValidJan, normalizeJan } from '../lib/jan'
import type { Nav } from '../lib/nav'
import layout from '../styles/layout.module.css'
import text from '../styles/text.module.css'
import styles from './ScanScreen.module.css'

/**
 * Phase A「捕獲」。ここは思考ゼロで終わらせる（§3.1）。
 * 既知の商品なら判定へ、未知なら登録へ直行する。間に確認画面を挟まない。
 */
export default function ScanScreen({ nav }: { nav: Nav }) {
  const [manual, setManual] = useState('')
  const [error, setError] = useState('')

  const open = async (jan: string) => {
    const known = await db.products.get(jan)
    nav.push(known ? { t: 'verdict', jan } : { t: 'register', jan })
  }

  const submitManual = async () => {
    const jan = normalizeJan(manual)
    if (!isValidJan(jan)) {
      setError('JAN は8桁または13桁で、チェックディジットが一致する必要があります')
      return
    }
    setError('')
    setManual('')
    await open(jan)
  }

  return (
    <Screen bleed>
      <CameraScanner onDetect={(jan) => void open(jan)} />

      <div className={styles.manual} onTouchStart={primeAudio}>
        <Label htmlFor="manual-jan">読めないときは手入力</Label>
        <div className={layout.row}>
          <TextInput
            id="manual-jan"
            mono
            value={manual}
            onChange={(e) => {
              setManual(e.target.value)
              setError('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitManual()
            }}
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="4901234567894"
            maxLength={13}
          />
          <Button variant="primary" onClick={() => void submitManual()}>
            開く
          </Button>
        </div>
        {error && <p className={text.error}>{error}</p>}
      </div>
    </Screen>
  )
}
