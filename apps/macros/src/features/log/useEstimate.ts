import { useState } from 'react'
import { matchDraft, totalOf, type EstimatedItem, type MealEstimate } from './estimate'

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
  error: string | null
  /** Given phase one; phase two follows automatically. */
  run: (describe: () => Promise<MealEstimate>) => Promise<void>
  reset: () => void
}

export function useEstimate(): EstimateRun {
  const [estimate, setEstimate] = useState<MealEstimate | null>(null)
  const [phase, setPhase] = useState<EstimatePhase>('idle')
  const [error, setError] = useState<string | null>(null)

  async function run(describe: () => Promise<MealEstimate>): Promise<void> {
    if (phase === 'reading' || phase === 'matching') return
    setPhase('reading')
    setError(null)
    try {
      const draft = await describe()
      setEstimate(draft)
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
    error,
    run,
    reset: () => {
      setEstimate(null)
      setPhase('idle')
      setError(null)
    },
  }
}

/** One row's result folded in, totals recomputed — the running figure has to agree with the rows. */
function patch(current: MealEstimate | null, item: EstimatedItem): MealEstimate | null {
  if (!current) return current
  const items = current.items.map((row) => (row.id === item.id ? item : row))
  return { ...current, items, nutrients: totalOf(items) }
}
