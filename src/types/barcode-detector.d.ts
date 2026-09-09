// BarcodeDetector はまだ標準の lib.dom に含まれていないので最小限だけ宣言する。
declare global {
  type DetectedBarcode = {
    rawValue: string
    format: string
    boundingBox: DOMRectReadOnly
  }

  class BarcodeDetector {
    constructor(options?: { formats?: string[] })
    static getSupportedFormats(): Promise<string[]>
    detect(source: CanvasImageSource | ImageBitmapSource): Promise<DetectedBarcode[]>
  }
}

export {}
