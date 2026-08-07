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

  // Lifts the user has actually trained, best recent set first — for one-tap
  // prefill so the estimate is grounded in their real numbers.
  const quickLifts = useMemo(() => {
    return data.exerciseSeries
      .map((series) => {
        const withTop = series.points.filter((p) => p.topSetKg !== null)
        const last = withTop[withTop.length - 1]
        if (!last || last.topSetKg === null) return null
        return {
          id: series.exerciseId,
          name: series.name,
          weightKg: last.topSetKg,
          reps: last.repRange ? last.repRange[0] : null,
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
            onChange={(event) => setWeight(event.target.value)}
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
            onChange={(event) => setReps(event.target.value.replace(/\D/g, ''))}
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
              }}
              className="shrink-0 rounded-full border border-line px-3 py-1 text-[12px] font-medium text-ink-secondary active:bg-accent-wash"
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
                Estimated 1RM
              </p>
              <p className="text-[30px] font-bold leading-tight text-accent">
                {displayWeight(e1rmKg, unit).toLocaleString()}
                <span className="ml-1 text-[15px] font-semibold">{unit}</span>
              </p>
            </div>

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
