import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

// 第一選択は Barcode Detection API（ネイティブ実装で高速・省電力）。
// iOS Safari は BarcodeDetector を実装していないため zxing-wasm フォールバックは必須（§4.1）。
// wasm はバンドル同梱のものを使う（CDN 取得にすると電波のない店内で死ぬ）。

export type ScanEngine = 'native' | 'wasm'

const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e']

export type Scanner = {
  engine: ScanEngine
  /** 1フレーム読む。見つからなければ null。 */
  scan: (video: HTMLVideoElement) => Promise<string | null>
}

const nativeSupported = async () => {
  if (typeof BarcodeDetector === 'undefined') return false
  try {
    const supported = await BarcodeDetector.getSupportedFormats()
    return NATIVE_FORMATS.some((f) => supported.includes(f))
  } catch {
    return false
  }
}

// バーコードは画面中央の帯にしか置かれない。切り出してから渡すと精度も速度も上がる。
const BAND_RATIO = 0.45
let canvas: HTMLCanvasElement | null = null

const grabBand = (video: HTMLVideoElement): ImageData | null => {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return null
  const bandH = Math.round(vh * BAND_RATIO)
  const y = Math.round((vh - bandH) / 2)
  canvas ??= document.createElement('canvas')
  canvas.width = vw
  canvas.height = bandH
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(video, 0, y, vw, bandH, 0, 0, vw, bandH)
  return ctx.getImageData(0, 0, vw, bandH)
}

const createNativeScanner = (): Scanner => {
  const detector = new BarcodeDetector({ formats: NATIVE_FORMATS })
  return {
    engine: 'native',
    scan: async (video) => {
      if (!video.videoWidth) return null
      const found = await detector.detect(video)
      return found[0]?.rawValue ?? null
    },
  }
}

const createWasmScanner = async (): Promise<Scanner> => {
  const { prepareZXingModule, readBarcodes } = await import('zxing-wasm/reader')
  // 同梱 wasm を指すよう locateFile を差し替える。既定は CDN 取得なのでオフラインで落ちる。
  await prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
    },
    fireImmediately: true,
  })
  return {
    engine: 'wasm',
    scan: async (video) => {
      const image = grabBand(video)
      if (!image) return null
      const results = await readBarcodes(image, {
        formats: ['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E'],
        tryHarder: true,
        tryRotate: false,
        tryInvert: false,
        maxNumberOfSymbols: 1,
      })
      const hit = results.find((r) => r.isValid && r.text)
      return hit?.text ?? null
    },
  }
}

let scannerPromise: Promise<Scanner> | null = null

export const getScanner = (): Promise<Scanner> => {
  // 失敗（wasm が取れない等）は覚えない。次に開いたときに取り直せるようにする
  scannerPromise ??= (async () => ((await nativeSupported()) ? createNativeScanner() : createWasmScanner()))().catch(
    (e: unknown) => {
      scannerPromise = null
      throw e
    },
  )
  return scannerPromise
}
