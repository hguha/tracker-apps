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
  const [source, setSource] = useState<string | null>(null)

  // Best recent set per trained lift; bestE1rmKg is the best across the range, used for comparison.
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

  // A heavy multi-rep set can legitimately project above a lighter true single, so say so.
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
