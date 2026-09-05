/**
 * Barcode scanning from the camera.
 *
 * Uses the platform `BarcodeDetector` where it exists. It is absent on iOS Safari, which is
 * the single most important target here, so `isBarcodeScanningAvailable()` must be checked
 * before offering the button — a scan option that silently does nothing is worse than none.
 * The native shell will use @capacitor-mlkit/barcode-scanning instead, and typing a barcode
 * remains the universal fallback.
 */

interface DetectedBarcode {
  rawValue: string
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>
}

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128']

function detectorCtor(): BarcodeDetectorCtor | null {
  const ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
  return ctor ?? null
}

export function isBarcodeScanningAvailable(): boolean {
  return detectorCtor() !== null && typeof navigator?.mediaDevices?.getUserMedia === 'function'
}

export interface ScanHandle {
  stop(): void
}

/**
 * Streams the rear camera into `video` and calls `onFound` with the first barcode seen.
 * Returns a handle whose `stop()` releases the camera — which must be called, or the
 * indicator light stays on after the sheet closes.
 */
export async function startScanning(
  video: HTMLVideoElement,
  onFound: (barcode: string) => void,
): Promise<ScanHandle> {
  const Ctor = detectorCtor()
  if (!Ctor) throw new Error('Barcode scanning is not available on this device')

  const detector = new Ctor({ formats: FORMATS })
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment' },
  })

  video.srcObject = stream
  await video.play()

  let stopped = false
  const tick = async () => {
    if (stopped) return
    try {
      const found = await detector.detect(video)
      const first = found[0]?.rawValue
      if (first) {
        onFound(first)
        return
      }
    } catch {
      // A transient decode failure is normal between frames; keep looking.
    }
    if (!stopped) requestAnimationFrame(() => void tick())
  }
  void tick()

  return {
    stop() {
      stopped = true
      for (const track of stream.getTracks()) track.stop()
      video.srcObject = null
    },
  }
}
