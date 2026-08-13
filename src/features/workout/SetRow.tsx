// Typing a value logs the set — there is no confirm step (§6.2).

import { Copy, Trash2, Trophy } from 'lucide-react'
import type {
  DistanceUnit,
  Exercise,
  PerformedSet,
  WeightUnit,
  WorkoutSet,
} from '@/domain/types'
import { SwipeableRow, useRowTap } from '@/components/SwipeableRow'
import { cn } from '@/lib/cn'
import { useDraftInput } from '@/lib/useDraftInput'
import {
  distanceFromM,
  distanceToM,
  formatDuration,
  parseNumber,
  weightFromKg,
  weightToKg,
} from '@/lib/units'

export interface SetRowProps {
  set: WorkoutSet
  index: number
  exercise: Exercise
  previous: PerformedSet | undefined
  // Must reflect only the previous session, never the current one: sharing this
  // with `previous` made the column echo the row's own carry-forward values.
  lastSession: PerformedSet | undefined
  weightUnit: WeightUnit
  distanceUnit: DistanceUnit
  showRpe: boolean
  isRecord: boolean
  onChange: (patch: Partial<WorkoutSet>) => void
  onDelete: () => void
  onConfirmPlaceholder: () => void
  onDuplicate: () => void
}

export function inputLayoutFor(exercise: Exercise): {
  weight: boolean
  reps: boolean
  duration: boolean
  distance: boolean
} {
  switch (exercise.trackingType) {
    case 'weight_reps':
    case 'weighted_bodyweight':
    case 'assisted_bodyweight':
      return { weight: true, reps: true, duration: false, distance: false }
    case 'bodyweight_reps':
    case 'reps_only':
      return { weight: false, reps: true, duration: false, distance: false }
    case 'time':
      return { weight: false, reps: false, duration: true, distance: false }
    case 'distance_time':
      return { weight: false, reps: false, duration: true, distance: true }
    case 'weight_time':
      return { weight: true, reps: false, duration: true, distance: false }
  }
}

// Values present means logged; a row with nothing typed is ignored everywhere (§6.2).
export function hasLoggedValues(set: WorkoutSet, exercise: Exercise): boolean {
  const layout = inputLayoutFor(exercise)
  if (layout.reps && set.reps !== null) return true
  if (layout.duration && set.durationSeconds !== null) return true
  if (layout.distance && set.distanceM !== null) return true
  // Weight alone counts only when it's the sole numeric field.
  if (layout.weight && set.weightKg !== null && !layout.reps && !layout.duration) {
    return true
  }
  return false
}

export function SetRow(props: SetRowProps) {
  const {
    set,
    index,
    exercise,
    previous,
    lastSession,
    weightUnit,
    distanceUnit,
    showRpe,
    isRecord,
    onChange,
    onDelete,
    onConfirmPlaceholder,
    onDuplicate,
  } = props

  const layout = inputLayoutFor(exercise)
  const isLogged = hasLoggedValues(set, exercise)

  return (
    <SwipeableRow
      leftAction={{
        label: 'Delete',
        icon: <Trash2 size={15} />,
        className: 'bg-critical',
        onAction: onDelete,
      }}
      rightAction={{
        label: isLogged ? 'Duplicate' : 'Same as last',
        icon: <Copy size={15} />,
        className: 'bg-accent',
        onAction: isLogged ? onDuplicate : onConfirmPlaceholder,
      }}
    >
      <div className="relative flex items-center gap-2 py-1.5 pl-3 pr-2.5">
        {/* Inset ring rather than a border, so nothing reflows. */}
        {isRecord && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-1 inset-y-0 rounded-lg ring-2 ring-inset"
            style={{ '--tw-ring-color': 'var(--status-good)' } as React.CSSProperties}
          />
        )}

        <div className="w-6 shrink-0 text-center">
          <span
            className={cn(
              'tabular text-[13px] font-semibold',
              isLogged ? 'text-ink' : 'text-ink-muted',
            )}
          >
            {index + 1}
          </span>
        </div>

        <div className="w-14 shrink-0 tabular text-[11.5px] leading-tight text-ink-muted">
          {formatPrevious(lastSession, weightUnit, distanceUnit)}
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {layout.weight && (
            <NumericField
              value={
                set.weightKg === null
                  ? ''
                  : String(weightFromKg(set.weightKg, weightUnit))
              }
              placeholder={
                previous?.weightKg != null
                  ? String(weightFromKg(previous.weightKg, weightUnit))
                  : ''
              }
              onCommit={(value) =>
                onChange({
                  weightKg: value === null ? null : weightToKg(value, weightUnit),
                  enteredUnit: weightUnit,
                })
              }
              ariaLabel={`weight in ${weightUnit}`}
            />
          )}
          {layout.reps && (
            <NumericField
              value={set.reps === null ? '' : String(set.reps)}
              placeholder={previous?.reps != null ? String(previous.reps) : ''}
              onCommit={(value) => onChange({ reps: value })}
              ariaLabel="reps"
              integer
            />
          )}
          {layout.duration && (
            <DurationField
              seconds={set.durationSeconds}
              placeholderSeconds={previous?.durationSeconds ?? null}
              onCommit={(seconds) => onChange({ durationSeconds: seconds })}
            />
          )}
          {layout.distance && (
            <NumericField
              value={
                set.distanceM === null
                  ? ''
                  : String(distanceFromM(set.distanceM, distanceUnit))
              }
              placeholder={
                previous?.distanceM != null
                  ? String(distanceFromM(previous.distanceM, distanceUnit))
                  : ''
              }
              onCommit={(value) =>
                onChange({
                  distanceM: value === null ? null : distanceToM(value, distanceUnit),
                })
              }
              ariaLabel={`distance in ${distanceUnit}`}
            />
          )}
          {showRpe && (
            <NumericField
              value={set.rpe === null ? '' : String(set.rpe)}
              placeholder=""
              onCommit={(value) => onChange({ rpe: value })}
              ariaLabel="RPE"
              className="w-12 flex-none"
            />
          )}
        </div>

        <div className="flex w-8 shrink-0 items-center justify-center">
          {isRecord ? (
            <Trophy
              size={17}
              aria-label="Personal record"
              style={{ color: 'var(--status-good)' }}
            />
          ) : isLogged ? (
            <span
              aria-label="Logged"
              className="size-2 rounded-full"
              style={{ background: 'var(--status-good)' }}
            />
          ) : previous ? (
            <SameAsLastButton onTap={onConfirmPlaceholder} />
          ) : null}
        </div>
      </div>
    </SwipeableRow>
  )
}

// Commits on `pointerup` (via `useRowTap`): a plain `onClick` inside a
// pointer-handling row doesn't reliably fire on iOS. Target is 44px and overhangs
// the row edge, where a thumb lands short as often as square.
function SameAsLastButton({ onTap }: { onTap: () => void }) {
  return (
    <button
      {...useRowTap(onTap)}
      aria-label="Log the same as last time"
      className="-my-1.5 -mr-2.5 flex h-11 w-[52px] items-center justify-center rounded-lg text-[10px] font-bold uppercase text-ink-muted active:bg-accent-wash"
    >
      Same
    </button>
  )
}

function formatPrevious(
  previous: PerformedSet | undefined,
  weightUnit: WeightUnit,
  distanceUnit: DistanceUnit,
): string {
  if (!previous) return '—'
  if (previous.distanceM !== null && previous.durationSeconds !== null) {
    return `${distanceFromM(previous.distanceM, distanceUnit)}${distanceUnit}`
  }
  if (previous.durationSeconds !== null) return formatDuration(previous.durationSeconds)
  if (previous.weightKg !== null && previous.reps !== null) {
    return `${weightFromKg(previous.weightKg, weightUnit)}×${previous.reps}`
  }
  if (previous.reps !== null) return `${previous.reps} reps`
  return '—'
}

// Commits on blur, not per keystroke: clearing the field mid-edit would briefly
// store null and un-log the set under the §6.2 rule.
function NumericField({
  value,
  placeholder,
  onCommit,
  ariaLabel,
  integer = false,
  className,
}: {
  value: string
  placeholder: string
  onCommit: (value: number | null) => void
  ariaLabel: string
  integer?: boolean
  className?: string
}) {
  const { isEmpty, inputProps } = useDraftInput({
    value,
    selectOnFocus: true,
    // Parse here so a non-numeric entry becomes null, never a stored NaN. A
    // negative weight/rep/duration is meaningless, so it reads as no value.
    onCommit: (draft) => {
      const parsed = parseNumber(draft)
      if (parsed === null || parsed < 0) return onCommit(null)
      onCommit(integer ? Math.round(parsed) : parsed)
    },
  })

  return (
    <input
      {...inputProps}
      placeholder={placeholder}
      inputMode={integer ? 'numeric' : 'decimal'}
      aria-label={ariaLabel}
      className={cn(
        'h-11 min-w-0 flex-1 touch-pan-y rounded-xl border text-center tabular text-[16px] font-semibold',
        'focus:border-accent focus:bg-surface focus:outline-none',
        isEmpty
          ? 'border-dashed border-line bg-transparent text-ink placeholder:text-ink-muted placeholder:font-normal'
          : 'border-line bg-sunken text-ink',
        className,
      )}
    />
  )
}

/** Duration entry as `m:ss`, because nobody thinks of a plank as 90 seconds. */
function DurationField({
  seconds,
  placeholderSeconds,
  onCommit,
}: {
  seconds: number | null
  placeholderSeconds: number | null
  onCommit: (seconds: number | null) => void
}) {
  const display = seconds === null ? '' : formatDuration(seconds)
  const { isEmpty, inputProps } = useDraftInput({
    value: display,
    selectOnFocus: true,
    onCommit: (draft) => onCommit(parseDuration(draft)),
  })

  return (
    <input
      {...inputProps}
      inputMode="numeric"
      placeholder={
        placeholderSeconds !== null ? formatDuration(placeholderSeconds) : 'm:ss'
      }
      aria-label="duration"
      className={cn(
        'h-11 min-w-0 flex-1 touch-pan-y rounded-xl border text-center tabular text-[16px] font-semibold',
        'focus:border-accent focus:bg-surface focus:outline-none',
        isEmpty
          ? 'border-dashed border-line bg-transparent text-ink placeholder:text-ink-muted placeholder:font-normal'
          : 'border-line bg-sunken text-ink',
      )}
    />
  )
}

/** Accepts `90`, `1:30`, or `1:30:00`. Bare numbers are read as seconds. */
export function parseDuration(input: string): number | null {
  const trimmed = input.trim()
  if (trimmed === '') return null
  const parts = trimmed.split(':').map((p) => Number(p))
  if (parts.some((p) => !Number.isFinite(p))) return null
  if (parts.length === 1) return parts[0]!
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
  return null
}
