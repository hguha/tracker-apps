import { useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import { Button } from '@tracker-engine/ui'

const MAX_EDGE = 1024
const JPEG_QUALITY = 0.8

export interface Photo {
  base64: string
  preview: string
  note: string
}

export function PhotoPanel({ onPhoto }: { onPhoto: (photo: Photo) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      const shrunk = await downscale(file)
      onPhoto({ base64: shrunk.base64, preview: shrunk.dataUrl, note })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read that photo.')
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
      <p className="text-[13px] text-ink-secondary">
        The whole plate with something for scale, or a label close enough to read.
      </p>
      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Anything the photo won't show (optional)"
        className="w-full rounded-xl bg-sunken px-3 py-2.5 text-[15px] outline-none"
      />
      <Button className="w-full" onClick={() => fileRef.current?.click()}>
        <Camera size={16} />
        Take a photo
      </Button>
      {error && (
        <p role="alert" className="text-[13px]" style={{ color: 'var(--status-critical)' }}>
          {error}
        </p>
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
