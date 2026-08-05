/**
 * One set. The most-touched component in the app (§6.2).
 *
 * The central rule: **typing a value logs the set.** There is no confirm step.
 * Last session's numbers show as gray placeholders; a row still showing only
 * placeholders has not happened and is ignored everywhere — volume, PRs, counts.
 *
 * This replaced a design with pre-filled real values and a confirm circle. The
 * circle read as decorative (nobody could say what it did), and pre-filling real
 * values meant a set the user never performed was already recorded as done.
 *
 * Other constraints that shaped this:
 *   - Which fields appear is decided entirely by `trackingType`, so cardio and
 *     lifting share one component instead of forking the screen.
 *   - A row whose values would beat a record glows immediately — the feedback
 *     has to land in the same frame as the keystroke, so it's computed locally.
 *   - No modal, ever. Editing happens in place.
 */

import { useEffect, useRef, useState } from 'react'
import { Copy, Trash2, Trophy } from 'lucide-react'
import type {
  DistanceUnit,
  Exercise,
  PerformedSet,
  WeightUnit,
  WorkoutSet,
} from '@/domain/types'
import { SwipeableRow } from '@/components/SwipeableRow'
import { cn } from '@/lib/cn'
import {
  distanceFromM,
  distanceToM,
  formatDuration,
  weightFromKg,
  weightToKg,
} from '@/lib/units'

export interface SetRowProps {
  set: WorkoutSet
  index: number
  exercise: Exercise
  /** Same set index from the last session — the placeholder source. */
  previous: PerformedSet | undefined
  weightUnit: WeightUnit
  distanceUnit: DistanceUnit
  showRpe: boolean
  /** True when these values would beat a stored record. Drives the glow. */
  isRecord: boolean
  onChange: (patch: Partial<WorkoutSet>) => void
  onDelete: () => void
  /** Copy the placeholder in as real values — "same as last time". */
  onConfirmPlaceholder: () => void
  onDuplicate: () => void
  onLongPress: () => void
}

/** Which inputs a tracking type needs. One switch, no forked screens. */
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

/**
 * Whether this row represents work that actually happened.
 *
 * The rule from §6.2: values present means logged. A row with nothing typed is
 * a placeholder and does not exist as far as any metric is concerned.
 */
export function hasLoggedValues(set: WorkoutSet, exercise: Exercise): boolean {
  const layout = inputLayoutFor(exercise)
  if (layout.reps && set.reps !== null) return true
  if (layout.duration && set.durationSeconds !== null) return true
  if (layout.distance && set.distanceM !== null) return true
  // Weight alone counts only when it's the sole numeric field, as in a carry
  // where duration might be filled first.
  if (layout.weight && set.weightKg !== null && !layout.reps && !layout.duration) {
    return true
  }
  return false
}

const SET_TYPE_BADGE: Partial<Record<WorkoutSet['setType'], string>> = {
  warmup: 'W',
  dropset: 'D',
  failure: 'F',
  amrap: 'A',
  backoff: 'B',
}

export function SetRow(props: SetRowProps) {
  const {
    set,
    index,
    exercise,
    previous,
    weightUnit,
    distanceUnit,
    showRpe,
    isRecord,
    onChange,
    onDelete,
    onConfirmPlaceholder,
    onDuplicate,
    onLongPress,
  } = props

  const layout = inputLayoutFor(exercise)
  const isLogged = hasLoggedValues(set, exercise)
  const isDropset = set.setType === 'dropset'
  const isWarmup = set.setType === 'warmup'

  const longPressTimer = useRef<number | null>(null)

  function startLongPress() {
    longPressTimer.current = window.setTimeout(onLongPress, 500)
  }
  function cancelLongPress() {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

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
      <div
        className={cn(
          'relative flex items-center gap-2 py-1.5 pr-2.5',
          // Dropsets indent under their parent set — the nesting is what
          // communicates "no rest between these".
          isDropset ? 'pl-7' : 'pl-3',
          isWarmup && 'opacity-55',
        )}
        onPointerDown={startLongPress}
        onPointerUp={cancelLongPress}
        onPointerLeave={cancelLongPress}
        onPointerCancel={cancelLongPress}
      >
        {/* PR glow — an inset ring rather than a border, so nothing reflows. */}
        {isRecord && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-1 inset-y-0 rounded-lg ring-2 ring-inset"
            style={{ '--tw-ring-color': 'var(--status-good)' } as React.CSSProperties}
          />
        )}

        {/* Set number, or a badge for a non-normal set type. */}
        <div className="w-6 shrink-0 text-center">
          {SET_TYPE_BADGE[set.setType] ? (
            <span className="text-[11px] font-bold text-ink-muted">
              {SET_TYPE_BADGE[set.setType]}
            </span>
          ) : (
            <span
              className={cn(
                'tabular text-[13px] font-semibold',
                isLogged ? 'text-ink' : 'text-ink-muted',
              )}
            >
              {index + 1}
            </span>
          )}
        </div>

        {/* Last time, for this exact set index. */}
        <div className="w-14 shrink-0 tabular text-[11.5px] leading-tight text-ink-muted">
          {formatPrevious(previous, weightUnit, distanceUnit)}
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {layout.weight && (
            <NumericField
              value={
                set.weightKg === null ? '' : String(weightFromKg(set.weightKg, weightUnit))
              }
              placeholder={
                previous?.weightKg != null
                  ? String(weightFromKg(previous.weightKg, weightUnit))
                  : ''
              }
              onCommit={(raw) =>
                onChange({
                  weightKg: raw === '' ? null : weightToKg(Number(raw), weightUnit),
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
              onCommit={(raw) => onChange({ reps: raw === '' ? null : Number(raw) })}
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
              onCommit={(raw) =>
                onChange({
                  distanceM: raw === '' ? null : distanceToM(Number(raw), distanceUnit),
                })
              }
              ariaLabel={`distance in ${distanceUnit}`}
            />
          )}
          {showRpe && (
            <NumericField
              value={set.rpe === null ? '' : String(set.rpe)}
              placeholder=""
              onCommit={(raw) => onChange({ rpe: raw === '' ? null : Number(raw) })}
              ariaLabel="RPE"
              className="w-12 flex-none"
            />
          )}
        </div>

        {/* Status column: a PR trophy, a logged tick, or the confirm affordance. */}
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
            <button
              onClick={onConfirmPlaceholder}
              aria-label="Log the same as last time"
              className="flex size-8 items-center justify-center rounded-lg text-[10px] font-bold uppercase text-ink-muted active:bg-accent-wash"
            >
              Same
            </button>
          ) : null}
        </div>
      </div>
    </SwipeableRow>
  )
}

/** The `prev` column. Compact enough to read without looking away from the bar. */
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

/**
 * A numeric field that commits on blur rather than per keystroke.
 *
 * Per-keystroke writes fight the user: typing "1", "12", "125" would each
 * persist, and clearing the field to retype would briefly store null — which,
 * under the §6.2 rule, would un-log the set mid-edit.
 */
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
  onCommit: (raw: string) => void
  ariaLabel: string
  integer?: boolean
  className?: string
}) {
  const [draft, setDraft] = useState(value)
  const isFocused = useRef(false)

  // Adopt external changes (a "same as last" tap, an edit elsewhere) unless
  // the user is mid-edit in this field.
  useEffect(() => {
    if (!isFocused.current) setDraft(value)
  }, [value])

  const isEmpty = draft === ''

  return (
    <input
      value={draft}
      placeholder={placeholder}
      inputMode={integer ? 'numeric' : 'decimal'}
      aria-label={ariaLabel}
      onFocus={(event) => {
        isFocused.current = true
        event.currentTarget.select()
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        isFocused.current = false
        if (draft !== value) onCommit(draft.trim())
      }}
      className={cn(
        'h-11 min-w-0 flex-1 rounded-xl border text-center tabular text-[16px] font-semibold',
        'focus:border-accent focus:bg-surface focus:outline-none',
        // An empty field is visibly provisional; a filled one is committed.
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
  const [draft, setDraft] = useState(display)
  const isFocused = useRef(false)

  useEffect(() => {
    if (!isFocused.current) setDraft(display)
  }, [display])

  const isEmpty = draft === ''

  return (
    <input
      value={draft}
      inputMode="numeric"
      placeholder={placeholderSeconds !== null ? formatDuration(placeholderSeconds) : 'm:ss'}
      aria-label="duration"
      onFocus={(event) => {
        isFocused.current = true
        event.currentTarget.select()
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        isFocused.current = false
        onCommit(parseDuration(draft))
      }}
      className={cn(
        'h-11 min-w-0 flex-1 rounded-xl border text-center tabular text-[16px] font-semibold',
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
