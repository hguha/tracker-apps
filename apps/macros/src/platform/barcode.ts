/**
 * Barcode scanning from the camera.
 *
 * Two decoders behind one call. `BarcodeDetector` is used where the platform has it (Android
 * Chrome, desktop Chrome); everywhere else a WebAssembly build of ZXing reads the frames. The
 * fallback is not a nicety: no version of WebKit implements `BarcodeDetector`, so on iOS — Safari,
 * an installed PWA and the App Store build alike — the feature was simply absent, which is the one
 * platform where scanning a wrapper instead of typing its name matters most.
 *
 * So availability now means "there is a camera", and typing the digits remains the universal
 * fallback for a scuffed label or a refused permission.
 */

import type { ReaderOptions } from 'zxing-wasm/reader'

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'itf']

const ZXING_FORMATS: ReaderOptions['formats'] = ['EAN13', 'EAN8', 'UPCA', 'UPCE', 'Code128', 'ITF']

const DECODE_INTERVAL_MS = 120

const DECODE_WIDTH = 720

interface DetectedBarcode {
  rawValue: string
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>
}

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike

function detectorCtor(): BarcodeDetectorCtor | null {
  const ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
  return ctor ?? null
}

export function isBarcodeScanningAvailable(): boolean {
  return typeof navigator?.mediaDevices?.getUserMedia === 'function'
}

export interface ScanHandle {
  stop(): void
}

type Decoder = (video: HTMLVideoElement) => Promise<string | null>

function nativeDecoder(): Decoder | null {
  const Ctor = detectorCtor()
  if (!Ctor) return null
  const detector = new Ctor({ formats: FORMATS })
  return async (video) => (await detector.detect(video))[0]?.rawValue ?? null
}

async function wasmDecoder(): Promise<Decoder> {
  const [{ prepareZXingModule, readBarcodes }, { default: wasmUrl }] = await Promise.all([
    import('zxing-wasm/reader'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ])
  prepareZXingModule({ overrides: { locateFile: () => wasmUrl } })

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('This browser cannot read the camera frames.')

  return async (video) => {
    if (video.videoWidth === 0) return null
    const scale = Math.min(1, DECODE_WIDTH / video.videoWidth)
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    context.drawImage(video, 0, 0, canvas.width, canvas.height)

    const found = await readBarcodes(context.getImageData(0, 0, canvas.width, canvas.height), {
      formats: ZXING_FORMATS,
      maxNumberOfSymbols: 1,
    })
    return found.find((result) => result.isValid && result.text)?.text ?? null
  }
}

/**
 * Streams the rear camera into `video` and calls `onFound` with the first barcode seen.
 * Returns a handle whose `stop()` releases the camera — which must be called, or the
 * indicator light stays on after the sheet closes.
 */
export async function startScanning(
  video: HTMLVideoElement,
  onFound: (barcode: string) => void,
  onUnreadable: (message: string) => void = () => {},
): Promise<ScanHandle> {
  if (!isBarcodeScanningAvailable()) {
    throw new Error('This device has no camera available to the app.')
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment' },
  })

  video.srcObject = stream
  await video.play()

  let stopped = false
  const release = () => {
    stopped = true
    for (const track of stream.getTracks()) track.stop()
    video.srcObject = null
  }

  void (async () => {
    let decode: Decoder
    try {
      decode = nativeDecoder() ?? (await wasmDecoder())
    } catch {
      release()
      onUnreadable('Could not start the barcode reader on this device.')
      return
    }

    while (!stopped) {
      try {
        const found = await decode(video)
        if (found) {
          onFound(found)
          return
        }
      } catch {
        // A transient decode failure is normal between frames; keep looking.
      }
      await new Promise((resolve) => setTimeout(resolve, DECODE_INTERVAL_MS))
    }
  })()

  return { stop: release }
}
