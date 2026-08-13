// Cardio entry (§6.5.1): a single block with derived pace rather than a set table.
// Intervals are still `sets` rows underneath, so nothing downstream changes.

import { Plus, Trash2 } from 'lucide-react'
import type {
  DistanceUnit,
  Exercise,
  PerformedSet,
  WeightUnit,
  WorkoutSet,
} from '@/domain/types'
import { cn } from '@/lib/cn'
import {
  distanceFromM,
  distanceToM,
  formatDuration,
  formatPace,
  parseNumber,
  weightFromKg,
  weightToKg,
} from '@/lib/units'
import { useDraftInput } from '@/lib/useDraftInput'
import { parseDuration } from './SetRow'

export interface CardioEntryProps {
  exercise: Exercise
  sets: WorkoutSet[]
  // Last session's entries, for placeholders. Aligned to `sets` by index.
  previous: (PerformedSet | undefined)[]
  weightUnit: WeightUnit
  distanceUnit: DistanceUnit
  onChange: (setId: string, patch: Partial<WorkoutSet>) => void
  onConfirmPlaceholder: (setId: string, shown: PerformedSet | undefined) => void
  onAddInterval: () => void
  onDeleteInterval: (setId: string) => void
}

export function CardioEntry(props: CardioEntryProps) {
  const {
    exercise,
    sets,
    previous,
    weightUnit,
    distanceUnit,
    onChange,
    onConfirmPlaceholder,
    onAddInterval,
    onDeleteInterval,
  } = props

  const wantsDistance = exercise.trackingType === 'distance_time'
  const wantsWeight = exercise.trackingType === 'weight_time'
  // Only label intervals once there's more than one.
  const isInterval = sets.length > 1

  return (
    <div className="px-3 pb-1 pt-2">
      {sets.map((set, index) => {
        const raw = previous[index]
        // An all-null carry-forward shouldn't offer a "Same as last" that copies
        // nothing (matches SetRow's placeholderAt guard).
        const placeholder =
          raw &&
          (raw.durationSeconds !== null ||
            raw.distanceM !== null ||
            raw.weightKg !== null)
            ? raw
            : undefined
        const pace = formatPace(set.durationSeconds, set.distanceM, distanceUnit)
        const hasValues = set.durationSeconds !== null || set.distanceM !== null

        return (
          <div key={set.id} className={cn(index > 0 && 'mt-3 border-t border-line pt-3')}>
            {isInterval && (
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  Interval {index + 1}
                </span>
                <button
                  onClick={() => onDeleteInterval(set.id)}
                  aria-label={`Remove interval ${index + 1}`}
                  className="flex size-7 items-center justify-center rounded-lg text-ink-muted active:bg-sunken"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )}

            <div className="flex items-end gap-2">
              <Field label="Time">
                <BigInput
                  value={
                    set.durationSeconds === null
                      ? ''
                      : formatDuration(set.durationSeconds)
                  }
                  placeholder={
                    placeholder?.durationSeconds != null
                      ? formatDuration(placeholder.durationSeconds)
                      : 'm:ss'
                  }
                  ariaLabel="duration"
                  onCommit={(raw) =>
                    onChange(set.id, { durationSeconds: parseDuration(raw) })
                  }
                />
              </Field>

              {wantsDistance && (
                <Field label={`Distance (${distanceUnit})`}>
                  <BigInput
                    value={
                      set.distanceM === null
                        ? ''
                        : String(distanceFromM(set.distanceM, distanceUnit))
                    }
                    placeholder={
                      placeholder?.distanceM != null
                        ? String(distanceFromM(placeholder.distanceM, distanceUnit))
                        : '0.00'
                    }
                    ariaLabel={`distance in ${distanceUnit}`}
                    onCommit={(raw) => {
                      const value = parseNumber(raw)
                      onChange(set.id, {
                        distanceM:
                          value === null ? null : distanceToM(value, distanceUnit),
                      })
                    }}
                  />
                </Field>
              )}

              {wantsWeight && (
                <Field label={`Weight (${weightUnit})`}>
                  <BigInput
                    value={
                      set.weightKg === null
                        ? ''
                        : String(weightFromKg(set.weightKg, weightUnit))
                    }
                    placeholder={
                      placeholder?.weightKg != null
                        ? String(weightFromKg(placeholder.weightKg, weightUnit))
                        : '0'
                    }
                    ariaLabel={`weight in ${weightUnit}`}
                    onCommit={(raw) => {
                      const value = parseNumber(raw)
                      onChange(set.id, {
                        weightKg: value === null ? null : weightToKg(value, weightUnit),
                        enteredUnit: weightUnit,
                      })
                    }}
                  />
                </Field>
              )}
            </div>

            <div className="mt-2 flex items-center justify-between">
              <span className="text-[13px] text-ink-secondary">
                {pace ? (
                  <>
                    Pace <span className="tabular font-semibold text-ink">{pace}</span>
                  </>
                ) : hasValues ? (
                  'Add both time and distance for pace'
                ) : (
                  ''
                )}
              </span>

              {!hasValues && placeholder && (
                <button
                  onClick={() => onConfirmPlaceholder(set.id, placeholder)}
                  className="rounded-lg px-2.5 py-1.5 text-[12.5px] font-bold uppercase tracking-wide text-accent active:bg-accent-wash"
                >
                  Same as last
                </button>
              )}
              {hasValues && (
                <span
                  className="flex items-center gap-1.5 text-[12px] font-semibold"
                  style={{ color: 'var(--status-good)' }}
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ background: 'var(--status-good)' }}
                  />
                  Logged
                </span>
              )}
            </div>
          </div>
        )
      })}

      <button
        onClick={onAddInterval}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong py-2.5 text-[13.5px] font-semibold text-ink-secondary active:bg-sunken"
      >
        <Plus size={15} />
        Add interval
      </button>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="min-w-0 flex-1">
      <span className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </span>
      {children}
    </label>
  )
}

function BigInput({
  value,
  placeholder,
  ariaLabel,
  onCommit,
}: {
  value: string
  placeholder: string
  ariaLabel: string
  // Receives the trimmed raw text; the caller parses (number vs m:ss).
  onCommit: (raw: string) => void
}) {
  const { isEmpty, inputProps } = useDraftInput({
    value,
    selectOnFocus: true,
    onCommit: (draft) => onCommit(draft.trim()),
  })

  return (
    <input
      {...inputProps}
      placeholder={placeholder}
      inputMode="decimal"
      aria-label={ariaLabel}
      className={cn(
        'tabular h-12 w-full rounded-xl border text-center text-[19px] font-semibold',
        'focus:border-accent focus:bg-surface focus:outline-none',
        isEmpty
          ? 'border-dashed border-line bg-transparent placeholder:font-normal placeholder:text-ink-muted'
          : 'border-line bg-sunken',
      )}
    />
  )
}
