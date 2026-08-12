/**
 * The PR estimator (1RM calculator).
 *
 * Type a weight and reps you've hit; it estimates your one-rep max (Epley) and
 * projects the weight you'd expect for other rep counts. Two ways in:
 *   - Enter numbers by hand.
 *   - Tap a lift you've trained to prefill your best recent set for it.
 *
 * Deliberately capped at 12 reps like every other e1RM in the app (§8.1) — past
 * that the formula's error exceeds what it measures, so the estimate is hidden
 * rather than shown as a confident wrong number.
 */

import { useMemo, useState } from 'react'
import { Card } from '@/components/Card'
import { cn } from '@/lib/cn'
import { estimatedOneRepMaxKg, PROJECTION_REPS, weightForRepsKg } from '@/lib/metrics'
import { displayWeight, weightFromKg, weightToKg } from '@/lib/units'
import type { InsightsData } from './useInsightsData'

export function PrEstimator({ data }: { data: InsightsData }) {
  const unit = data.profile.unitWeight
  const [weight, setWeight] = useState('')
  const [reps, setReps] = useState('')

  /** Which lift the numbers came from, when they were prefilled by a chip. */
  const [source, setSource] = useState<string | null>(null)

  // Lifts the user has actually trained, best recent set first — for one-tap
  // prefill so the estimate is grounded in their real numbers. `bestE1rmKg` is
  // the best across the whole range, which is what the estimate gets compared to.
  const quickLifts = useMemo(() => {
    return data.exerciseSeries
      .map((series) => {
        const withTop = series.points.filter((p) => p.topSetKg !== null)
        const last = withTop[withTop.length - 1]
        if (!last || last.topSetKg === null) return null
        const bestE1rmKg = series.points.reduce<number | null>(
          (best, p) =>
            p.e1rmKg !== null && (best === null || p.e1rmKg > best) ? p.e1rmKg : best,
          null,
        )
        return {
          id: series.exerciseId,
          name: series.name,
          weightKg: last.topSetKg,
          reps: last.repRange ? last.repRange[0] : null,
          bestE1rmKg,
        }
      })
      .filter((l): l is NonNullable<typeof l> => l !== null && l.reps !== null)
      .slice(0, 6)
  }, [data.exerciseSeries])

  const weightNum = weight === '' ? null : Number(weight)
  const repsNum = reps === '' ? null : Number(reps)
  const weightKg =
    weightNum !== null && Number.isFinite(weightNum) ? weightToKg(weightNum, unit) : null
  const e1rmKg = estimatedOneRepMaxKg(weightKg, repsNum)

  /**
   * How this estimate relates to the lift's actual best, when the numbers came
   * from a prefill chip.
   *
   * The confusing case, reported: prefilling a deadlift showed 365 × 1 in the
   * fields and "377" as the estimate. That specific number came from Epley
   * scaling a single rep, now fixed — but the general shape remains, because a
   * heavy multi-rep set legitimately projects *above* a lighter true single. Say
   * so rather than leaving two numbers to contradict each other.
   */
  const comparison = useMemo(() => {
    const lift = quickLifts.find((l) => l.id === source)
    if (!lift || e1rmKg === null || lift.bestE1rmKg === null) return null
    const best = displayWeight(lift.bestE1rmKg, unit)
    const estimate = displayWeight(e1rmKg, unit)
    if (estimate > best) {
      return `Above your best estimate for ${lift.name} (${best} ${unit}) — this set projects higher than anything you've actually hit.`
    }
    if (estimate === best) {
      return `This is your best estimate for ${lift.name}.`
    }
    return `Your best estimate for ${lift.name} is ${best} ${unit}, from a different set.`
  }, [quickLifts, source, e1rmKg, unit])

  return (
    <Card className="overflow-hidden">
      <div className="px-4 pt-3.5">
        <h2 className="text-[15px] font-semibold tracking-tight">PR estimator</h2>
        <p className="text-[12.5px] text-ink-muted">
          Estimate your 1RM and projected maxes from any set
        </p>
      </div>

      <div className="flex items-end gap-2 px-4 pt-3">
        <Field label={`Weight (${unit})`}>
          <input
            value={weight}
            onChange={(event) => {
              setWeight(event.target.value)
              setSource(null)
            }}
            inputMode="decimal"
            placeholder="0"
            aria-label={`weight in ${unit}`}
            className="tabular h-12 w-full rounded-xl border border-line bg-sunken text-center text-[18px] font-semibold outline-none focus:border-accent focus:bg-surface"
          />
        </Field>
        <span className="pb-3 text-[15px] font-semibold text-ink-muted">×</span>
        <Field label="Reps">
          <input
            value={reps}
            onChange={(event) => {
              setReps(event.target.value.replace(/\D/g, ''))
              setSource(null)
            }}
            inputMode="numeric"
            placeholder="0"
            aria-label="reps"
            className="tabular h-12 w-full rounded-xl border border-line bg-sunken text-center text-[18px] font-semibold outline-none focus:border-accent focus:bg-surface"
          />
        </Field>
      </div>

      {quickLifts.length > 0 && (
        <div className="mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1">
          {quickLifts.map((lift) => (
            <button
              key={lift.id}
              onClick={() => {
                setWeight(String(weightFromKg(lift.weightKg, unit)))
                setReps(String(lift.reps))
                setSource(lift.id)
              }}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1 text-[12px] font-medium active:bg-accent-wash',
                source === lift.id
                  ? 'border-accent bg-accent-wash text-accent'
                  : 'border-line text-ink-secondary',
              )}
            >
              {lift.name}
            </button>
          ))}
        </div>
      )}

      <div className="px-4 pb-4 pt-3">
        {e1rmKg === null ? (
          <p className="rounded-xl bg-sunken px-4 py-5 text-center text-[13.5px] text-ink-muted">
            {repsNum !== null && repsNum > 12
              ? 'Enter 12 reps or fewer — past that the estimate isn’t reliable.'
              : 'Enter a weight and reps to see your estimated 1RM.'}
          </p>
        ) : (
          <>
            <div className="rounded-xl bg-accent-wash px-4 py-3 text-center">
              <p className="text-[11.5px] font-semibold uppercase tracking-wide text-accent">
                {repsNum === 1 ? 'One-rep max' : 'Estimated 1RM'}
              </p>
              <p className="text-[30px] font-bold leading-tight text-accent">
                {displayWeight(e1rmKg, unit).toLocaleString()}
                <span className="ml-1 text-[15px] font-semibold">{unit}</span>
              </p>
              {/* A single rep isn't estimated — it's what was lifted. Saying so
                  stops the headline from looking like it disagrees with the input. */}
              {repsNum === 1 && (
                <p className="mt-0.5 text-[11.5px] text-accent/80">
                  A single rep is your max — nothing to estimate.
                </p>
              )}
            </div>

            {comparison && (
              <p className="mt-2 rounded-xl bg-sunken px-3 py-2 text-[12px] text-ink-secondary">
                {comparison}
              </p>
            )}

            {/* Projected working weights across the rep range. */}
            <div className="mt-3 grid grid-cols-4 gap-1.5">
              {PROJECTION_REPS.map((r) => {
                const projected = weightForRepsKg(e1rmKg, r)
                if (projected === null) return null
                const isInput = r === repsNum
                return (
                  <div
                    key={r}
                    className={cn(
                      'rounded-lg border px-1 py-2 text-center',
                      isInput ? 'border-accent bg-accent-wash' : 'border-line bg-surface',
                    )}
                  >
                    <p className="text-[11px] font-semibold text-ink-muted">{r}RM</p>
                    <p className="tabular text-[15px] font-bold">
                      {Math.round(weightFromKg(projected, unit))}
                    </p>
                  </div>
                )
              })}
            </div>
            <p className="mt-2 px-1 text-[11.5px] text-ink-muted">
              Estimates use the Epley formula. Treat them as a target, not a guarantee.
            </p>
          </>
        )}
      </div>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="min-w-0 flex-1">
      <span className="mb-1 block text-center text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </span>
      {children}
    </label>
  )
}
