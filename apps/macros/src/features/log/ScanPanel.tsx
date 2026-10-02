import { useEffect, useRef, useState } from 'react'
import { Button } from '@tracker-engine/ui'
import { startScanning, type ScanHandle } from '@/platform/barcode'
import * as repo from '@/data/repository'
import { lookupBarcode } from '@/data/foodLookup'
import type { Food } from '@/domain/types'

type State =
  | { kind: 'scanning' }
  | { kind: 'looking-up'; barcode: string }
  | { kind: 'not-found'; barcode: string }
  | { kind: 'failed'; message: string }

/** Camera scan, then lookup. Typing the digits stays available throughout, because a scan can
 *  fail for reasons the user can't fix (a scuffed label, low light, no camera permission). */
export function ScanPanel({
  onFound,
  onCreate,
}: {
  onFound: (food: Food) => void
  /** A barcode neither database has: the label in the user's hand is the only source left. */
  onCreate: (barcode: string) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const handleRef = useRef<ScanHandle | null>(null)
  const [state, setState] = useState<State>({ kind: 'scanning' })
  const [typed, setTyped] = useState('')

  async function resolve(barcode: string) {
    setState({ kind: 'looking-up', barcode })
    const food = await lookupBarcode(barcode)
    if (food) {
      onFound(await repo.keepAsOwnFood(food))
      return
    }
    setState({ kind: 'not-found', barcode })
  }

  useEffect(() => {
    let cancelled = false
    const video = videoRef.current
    if (!video) return

    void startScanning(
      video,
      (barcode) => {
        if (cancelled) return
        handleRef.current?.stop()
        void resolve(barcode)
      },
      (message) => {
        if (!cancelled) setState({ kind: 'failed', message })
      },
    )
      .then((handle) => {
        if (cancelled) handle.stop()
        else handleRef.current = handle
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            kind: 'failed',
            message:
              error instanceof Error ? error.message : 'Could not start the camera.',
          })
        }
      })

    // Releasing the camera matters: without this the indicator light stays on after the
    // sheet closes, which reads as the app still watching.
    return () => {
      cancelled = true
      handleRef.current?.stop()
      handleRef.current = null
    }
  }, [])

  return (
    <div className="flex flex-col">
      <div className="px-4 py-3">
        {state.kind === 'failed' ? (
          <p className="rounded-xl bg-sunken px-3.5 py-2.5 text-[13.5px] text-ink-secondary">
            {state.message} Type the number underneath the barcode instead.
          </p>
        ) : (
          <div className="relative overflow-hidden rounded-xl bg-black">
            <video
              ref={videoRef}
              playsInline
              muted
              className="aspect-[4/3] w-full object-cover"
            />
            {state.kind === 'looking-up' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-[14px] font-semibold text-white">
                Looking up {state.barcode}…
              </div>
            )}
          </div>
        )}

        {state.kind === 'not-found' && (
          <div className="mt-2 rounded-xl bg-sunken px-3.5 py-2.5">
            <p className="text-[13px] text-ink-secondary">
              Nothing found for {state.barcode}. It may not be in USDA or Open Food Facts yet.
            </p>
            <button
              onClick={() => onCreate(state.barcode)}
              className="mt-2 text-[13.5px] font-semibold text-accent active:opacity-60"
            >
              Add it from the label →
            </button>
          </div>
        )}

        <p className="mt-2 text-[12px] text-ink-muted">
          Anything you scan is saved to your foods, ready for a recipe.
        </p>

        <div className="mt-3 flex items-center gap-2">
          <input
            inputMode="numeric"
            value={typed}
            onChange={(event) => setTyped(event.target.value.replace(/\D+/g, ''))}
            placeholder="Or type the barcode"
            className="min-w-0 flex-1 rounded-xl bg-sunken px-3 py-2 text-[15px] outline-none"
          />
          <Button disabled={typed.length < 6} onClick={() => void resolve(typed)}>
            Look up
          </Button>
        </div>
      </div>
    </div>
  )
}
