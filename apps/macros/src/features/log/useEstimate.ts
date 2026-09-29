import { useEffect, useRef, useState } from 'react'
import { matchDraft, SECOND_MS, totalOf, type EstimatedItem, type MealEstimate } from './estimate'

/**
 * Running a breakdown in two visible phases.
 *
 * It used to be one `await` behind one spinner: the model request, then up to a dozen food-database
 * round trips, then the whole draft appeared at once. Half a minute of a button that said "Working
 * it out…" is indistinguishable from a screen that has hung — and the first half of the answer was
 * ready in a couple of seconds the whole time.
 *
 * So the model's reading lands as soon as it arrives, and each row fills in where the user can watch
 * it. Nothing is faster in total; it is simply no longer opaque, and the part people care about
 * (*did it understand me?*) shows up first.
 */
export type EstimatePhase = 'idle' | 'reading' | 'matching' | 'done'

export interface EstimateRun {
  estimate: MealEstimate | null
  setEstimate: (estimate: MealEstimate) => void
  phase: EstimatePhase
  /**
   * Seconds since this run started, while it is running.
   *
   * The whole answer to "is it stalling or is it just slow". The model is 2s warm and 12s cold, and a
   * spinner that says the same thing at 2s and at 40s leaves the user with no way to tell a working
   * request from a hung one — so they wait, or they leave and lose the request.
   */
  elapsed: number
  error: string | null
  /** Given phase one; phase two follows automatically, unless phase one read one named product. */
  run: (describe: () => Promise<MealEstimate>) => Promise<void>
  reset: () => void
}

export function useEstimate(): EstimateRun {
  const [estimate, setEstimate] = useState<MealEstimate | null>(null)
  const [phase, setPhase] = useState<EstimatePhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const startedAt = useRef(0)

  const isBusy = phase === 'reading' || phase === 'matching'
  useEffect(() => {
    if (!isBusy) return
    const id = window.setInterval(
      () => setElapsed(Math.round((Date.now() - startedAt.current) / SECOND_MS)),
      SECOND_MS,
    )
    return () => window.clearInterval(id)
  }, [isBusy])

  async function run(describe: () => Promise<MealEstimate>): Promise<void> {
    if (phase === 'reading' || phase === 'matching') return
    startedAt.current = Date.now()
    setElapsed(0)
    setPhase('reading')
    setError(null)
    try {
      const draft = await describe()
      setEstimate(draft)
      // A named product has no ingredients to look up: its panel *is* the answer, and the review
      // card shows it straight away.
      if (draft.product) {
        setPhase('done')
        return
      }
      setPhase('matching')
      const matched = await matchDraft(draft, (item) => setEstimate((current) => patch(current, item)))
      setEstimate(matched)
      setPhase('done')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not work that out.')
      setPhase(estimate ? 'done' : 'idle')
    }
  }

  return {
    estimate,
    setEstimate,
    phase,
    elapsed,
    error,
    run,
    reset: () => {
      setEstimate(null)
      setPhase('idle')
      setError(null)
      setElapsed(0)
    },
  }
}

/** One row's result folded in, totals recomputed — the running figure has to agree with the rows. */
function patch(current: MealEstimate | null, item: EstimatedItem): MealEstimate | null {
  if (!current) return current
  const items = current.items.map((row) => (row.id === item.id ? item : row))
  return { ...current, items, nutrients: totalOf(items) }
}
