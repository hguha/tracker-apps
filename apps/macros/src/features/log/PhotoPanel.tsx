import { useRef, useState } from 'react'
import { Camera, RotateCcw } from 'lucide-react'
import { Button } from '@tracker-engine/ui'
import { EstimateReview } from './EstimateReview'
import type { LogTarget } from './target'
import { describePhoto, type FoodDraft } from './estimate'
import { useEstimate } from './useEstimate'

/** Below this the model can't resolve a plate; above it the upload is slow on a phone. */
const MAX_EDGE = 1024
const JPEG_QUALITY = 0.8

/**
 * Logging from a photo.
 *
 * The photo never leaves as a nutrition figure: the model returns ingredient names and weights,
 * the client matches them to food rows and computes everything, and the draft says what it assumed
 * for scale. A photo genuinely cannot show the oil a dish was cooked in — so this is the weakest
 * of the logging paths, and it's presented as a starting point rather than an answer.
 *
 * Downscaled before upload: a modern phone photo is several megabytes, which on a poor connection
 * fails long before the model would have struggled with it.
 */
export function PhotoPanel({
  target,
  onDone,
  onProduct,
}: {
  target: LogTarget
  onDone: () => void
  onProduct: (product: FoodDraft) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const { estimate, setEstimate, phase, error, run, reset } = useEstimate()
  const [shrinkError, setShrinkError] = useState<string | null>(null)
  const isBusy = phase === 'reading' || phase === 'matching'

  async function handleFile(file: File | undefined) {
    if (!file) return
    reset()
    setShrinkError(null)
    try {
      const shrunk = await downscale(file)
      setPreview(shrunk.dataUrl)
      await run(() => describePhoto(shrunk.base64, 'image/jpeg', note), onProduct)
    } catch (cause) {
      setShrinkError(cause instanceof Error ? cause.message : 'Could not read that photo.')
    }
  }

  return (
    <div className="space-y-3 px-4 py-3">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />

      {preview ? (
        <div className="relative overflow-hidden rounded-xl bg-black">
          <img src={preview} alt="The meal you photographed" className="max-h-56 w-full object-cover" />
        </div>
      ) : (
        <p className="text-[13px] text-ink-secondary">
          The whole plate with something for scale, or a label close enough to read.
        </p>
      )}

      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Anything the photo won't show (optional)"
        className="w-full rounded-xl bg-sunken px-3 py-2.5 text-[15px] outline-none"
      />

      <Button className="w-full" disabled={isBusy} onClick={() => fileRef.current?.click()}>
        {preview ? <RotateCcw size={16} /> : <Camera size={16} />}
        {phase === 'reading'
          ? 'Looking at it…'
          : phase === 'matching'
            ? 'Finding the foods…'
            : preview
              ? 'Take another'
              : 'Take a photo'}
      </Button>

      {(error ?? shrinkError) !== null && (
        <p
          role="alert"
          className="rounded-xl px-3.5 py-2.5 text-[13px]"
          style={{
            background: 'color-mix(in srgb, var(--status-critical) 10%, transparent)',
            color: 'var(--status-critical)',
          }}
        >
          {error ?? shrinkError}
        </p>
      )}

      {estimate && (
        <EstimateReview
          estimate={estimate}
          target={target}
          source="photo"
          onChange={setEstimate}
          onDone={onDone}
          onRefine={(extra) => {
            setNote(extra)
            fileRef.current?.click()
          }}
          isRefining={isBusy}
        />
      )}
    </div>
  )
}

async function downscale(file: File): Promise<{ dataUrl: string; base64: string }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)

  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot process the photo.')
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  return { dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1) }
}
