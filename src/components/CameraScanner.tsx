import { useEffect, useRef, useState } from 'react'
import { cx } from '../lib/cx'
import { scanFeedback } from '../lib/feedback'
import { isValidJan, normalizeJan } from '../lib/jan'
import { getScanner, type ScanEngine } from '../lib/scanner'
import styles from './CameraScanner.module.css'

type Status = 'starting' | 'running' | 'error'

/** チェックディジットが通らないコードは無視する。誤読で別商品を開く方が事故が大きい。 */
export default function CameraScanner({ onDetect }: { onDetect: (jan: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  // 検出コールバックは最新のものを使いたいが、スキャンループは張り替えたくないので ref 経由にする
  const onDetectRef = useRef(onDetect)
  useEffect(() => {
    onDetectRef.current = onDetect
  }, [onDetect])

  const [status, setStatus] = useState<Status>('starting')
  const [engine, setEngine] = useState<ScanEngine | null>(null)
  const [error, setError] = useState('')
  const [torch, setTorch] = useState<{ on: boolean; available: boolean }>({ on: false, available: false })
  const trackRef = useRef<MediaStreamTrack | null>(null)

  useEffect(() => {
    let cancelled = false
    let stream: MediaStream | null = null
    let timer: number | undefined

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('error')
        setError('このブラウザではカメラを使えません。HTTPS でアクセスしているか確認してください。')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        })
      } catch (e) {
        if (cancelled) return
        setStatus('error')
        setError(
          e instanceof DOMException && e.name === 'NotAllowedError'
            ? 'カメラが許可されていません。ブラウザの設定で許可するか、下のJAN手入力を使ってください。'
            : 'カメラを開始できませんでした。下のJAN手入力を使ってください。',
        )
        return
      }
      // StrictMode の二重実行や高速な画面遷移で取り残されたストリームを止める
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }

      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      try {
        await video.play()
      } catch {
        // 自動再生が弾かれても以降のフレーム取得には影響しないことが多い
      }

      const track = stream.getVideoTracks()[0]
      trackRef.current = track ?? null
      const caps = track?.getCapabilities?.() as { torch?: boolean } | undefined
      if (caps?.torch) setTorch({ on: false, available: true })

      const scanner = await getScanner()
      if (cancelled) return
      setEngine(scanner.engine)
      setStatus('running')

      // ネイティブは軽いので短い間隔、wasm は 1 フレームが重いので間隔を空ける
      const interval = scanner.engine === 'native' ? 120 : 220
      const tick = async () => {
        if (cancelled) return
        try {
          const raw = await scanner.scan(video)
          if (raw) {
            const jan = normalizeJan(raw)
            if (isValidJan(jan)) {
              scanFeedback()
              onDetectRef.current(jan)
              return
            }
          }
        } catch {
          // 1フレーム読めなかっただけ。次のフレームで拾う
        }
        timer = window.setTimeout(tick, interval)
      }
      void tick()
    }

    void start()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      trackRef.current = null
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const toggleTorch = async () => {
    const track = trackRef.current
    if (!track) return
    const next = !torch.on
    try {
      // torch は MediaTrackConstraints の型定義に無いので、ここだけ通す
      await track.applyConstraints({ advanced: [{ torch: next }] } as unknown as MediaTrackConstraints)
      setTorch({ on: next, available: true })
    } catch {
      setTorch((t) => ({ ...t, available: false }))
    }
  }

  return (
    <div className={styles.camera}>
      <video ref={videoRef} className={styles.video} playsInline muted autoPlay />
      {/* 四隅のトンボはデコード対象の帯と一致している。ここに合わせてもらう。 */}
      <div className={styles.frame} aria-hidden>
        <span />
        <span />
        <span />
        <span />
        {status === 'running' && <div className={styles.scanline} />}
      </div>
      <p className={styles.wordmark} aria-hidden>
        またこれ
      </p>
      {/* どちらのエンジンで読んでいるかは実機で切り分けるときに要る */}
      {engine && <span className={styles.engine}>{engine}</span>}
      <div className={styles.status}>
        {status === 'starting' && 'カメラを起動中…'}
        {status === 'running' && '枠に合わせてください'}
        {status === 'error' && error}
      </div>
      {torch.available && (
        <button type="button" className={cx(styles.torch, torch.on && styles.torchOn)} onClick={toggleTorch}>
          ライト
        </button>
      )}
    </div>
  )
}
