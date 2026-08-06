/**
 * One exercise within a session: the last-time header, its set rows, and the
 * add-set action.
 *
 * The header is rendered unconditionally, never behind a tap (§1, §6.3). It is
 * the most useful information mid-workout — "what did I do last time" is the
 * question every set starts with — so it costs zero interaction.
 *
 * PR candidacy is computed here rather than in the row, because it needs the
 * stored records for the whole exercise and the row shouldn't each fetch them.
 */

import { useEffect, useMemo, useState } from 'react'
import { GripVertical, MoreHorizontal, Plus } from 'lucide-react'
import { Card } from '@/components/Card'
import * as repo from '@/data/repository'
import { cn } from '@/lib/cn'
import { formatRelativeDay } from '@/lib/dates'
import { convertWeight, formatDuration, weightFromKg } from '@/lib/units'
import type {
  DistanceUnit,
  Exercise,
  LastPerformance,
  Muscle,
  PerformedSet,
  WeightUnit,
  WorkoutSet,
} from '@/domain/types'
import { regionVar } from '@/lib/palette'
import { CardioEntry } from './CardioEntry'
import { SetRow, hasLoggedValues } from './SetRow'

/** The subset of a performed set that can act as a placeholder. */
export interface SetPlaceholderHint {
  weightKg: number | null
  reps: number | null
  durationSeconds: number | null
  distanceM: number | null
}

/** Whether a placeholder carries anything worth showing as a ghost value. */
function hasValue(p: {
  weightKg: number | null
  reps: number | null
  durationSeconds: number | null
  distanceM: number | null
}): boolean {
  return (
    p.weightKg !== null ||
    p.reps !== null ||
    p.durationSeconds !== null ||
    p.distanceM !== null
  )
}

export interface ExerciseCardProps {
  exercise: Exercise
  muscle: Muscle | undefined
  sets: WorkoutSet[]
  lastPerformance: LastPerformance | undefined
  weightUnit: WeightUnit
  distanceUnit: DistanceUnit
  showRpe: boolean
  /** Non-null marks this card as part of a superset group (§6.4). */
  supersetGroup: number | null
  /**
   * Per-set placeholder hints from a "do this again" copy (§7.2), keyed by set id.
   * These win over history, because repeating a specific session should suggest
   * that session's numbers.
   */
  placeholderOverrides: Record<string, PerformedSet | SetPlaceholderHint>
  onAddSet: () => void
  onSetChange: (setId: string, patch: Partial<WorkoutSet>) => void
  onDeleteSet: (setId: string) => void
  onConfirmPlaceholder: (setId: string) => void
  onDuplicateSet: (setId: string) => void
  onOpenDetail: () => void
}

export function ExerciseCard(props: ExerciseCardProps) {
  const {
    exercise,
    muscle,
    sets,
    lastPerformance,
    weightUnit,
    distanceUnit,
    showRpe,
    supersetGroup,
    placeholderOverrides,
    onAddSet,
    onSetChange,
    onDeleteSet,
    onConfirmPlaceholder,
    onDuplicateSet,
    onOpenDetail,
  } = props

  /**
   * Which set ids currently hold record-beating values. Recomputed whenever the
   * sets change, so the glow tracks edits rather than only firing once.
   */
  const [recordSetIds, setRecordSetIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const matches = new Set<string>()
      for (const set of sets) {
        if (!hasLoggedValues(set, exercise)) continue
        const broken = await repo.previewRecords(exercise.id, set)
        if (broken.length > 0) matches.add(set.id)
      }
      if (!cancelled) setRecordSetIds(matches)
    })()
    return () => {
      cancelled = true
    }
  }, [sets, exercise])

  const lastSession = lastPerformance?.sessions[0]
  const isCardio = exercise.movementPattern === 'cardio'

  /** Sets from last time, lined up with this session's rows by index. */
  const previousSets = useMemo<PerformedSet[]>(
    () => lastSession?.sets ?? [],
    [lastSession],
  )

  /**
   * The placeholder for each row, resolved once in row order (§6.2, §7.2).
   *
   * Precedence per row, highest first:
   *   1. A per-set override from a repeated workout or a template (§7.2) — an
   *      explicit request for *that* source's numbers.
   *   2. The matching set from the last time this exercise was trained.
   *   3. Carry-forward: the most recent non-empty placeholder from earlier in
   *      this same card — so set 4 suggests set 3's numbers.
   * Blank only when the exercise has never been done and nothing precedes the
   * row — which, given carry-forward, effectively never happens after set 1.
   */
  const placeholderFor = useMemo<(PerformedSet | undefined)[]>(() => {
    const resolved: (PerformedSet | undefined)[] = []
    let carry: PerformedSet | undefined

    sets.forEach((set, index) => {
      const override = placeholderOverrides[set.id]
      const candidate: PerformedSet | undefined = override
        ? {
            weightKg: override.weightKg,
            reps: override.reps,
            durationSeconds: override.durationSeconds,
            distanceM: override.distanceM,
          }
        : (previousSets[index] ?? carry)

      resolved.push(candidate)
      if (candidate && hasValue(candidate)) carry = candidate
    })
    return resolved
  }, [sets, placeholderOverrides, previousSets])

  /** A placeholder with nothing in it shouldn't render as one. */
  function placeholderAt(index: number): PerformedSet | undefined {
    const candidate = placeholderFor[index]
    return candidate && hasValue(candidate) ? candidate : undefined
  }

  return (
    <Card
      className={cn(
        'overflow-hidden',
        // A superset is a shared left rule rather than a box, so grouped cards
        // still read as separate exercises.
        supersetGroup !== null && 'border-l-[3px] border-l-accent',
      )}
    >
      <div className="flex items-start gap-1 px-2.5 pt-3 pb-1">
        {/* Drag affordance. The whole card is draggable; this says so. */}
        <span className="mt-0.5 shrink-0 text-ink-muted/60" aria-hidden>
          <GripVertical size={16} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {muscle && (
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: regionVar(muscle.region) }}
                aria-hidden
              />
            )}
            <h3 className="truncate text-[16px] font-semibold tracking-tight">
              {exercise.name}
            </h3>
            {supersetGroup !== null && (
              <span className="shrink-0 rounded-full bg-accent-wash px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
                Superset
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[12.5px] text-ink-secondary">
            {summarizeLastSession(lastPerformance, weightUnit, distanceUnit)}
          </p>
          {loggingHint(exercise, weightUnit) && (
            <p className="mt-0.5 text-[11.5px] text-ink-muted">
              {loggingHint(exercise, weightUnit)}
            </p>
          )}
        </div>

        <button
          onClick={onOpenDetail}
          aria-label={`${exercise.name} details`}
          className="-mr-0.5 -mt-1 flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-muted active:bg-sunken"
        >
          <MoreHorizontal size={18} />
        </button>
      </div>

      {isCardio ? (
        <div className="border-t border-line">
          <CardioEntry
            exercise={exercise}
            sets={sets}
            previous={placeholderFor}
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
            onChange={onSetChange}
            onConfirmPlaceholder={onConfirmPlaceholder}
            onAddInterval={onAddSet}
            onDeleteInterval={onDeleteSet}
          />
        </div>
      ) : (
        <>
      {/* Column headings, so an untouched first-ever row still reads clearly. */}
      <div className="mt-1 flex items-center gap-2 border-t border-line px-3 pb-1 pt-1.5 pr-2.5">
        <span className="w-6 shrink-0 text-center text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
          Set
        </span>
        <span className="w-14 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
          Last
        </span>
        <span className="flex min-w-0 flex-1 gap-1.5">
          {columnLabels(exercise, weightUnit, distanceUnit).map((label) => (
            <span
              key={label}
              className="flex-1 text-center text-[10px] font-semibold uppercase tracking-wide text-ink-muted"
            >
              {label}
            </span>
          ))}
          {showRpe && (
            <span className="w-12 flex-none text-center text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
              RPE
            </span>
          )}
        </span>
        <span className="w-8 shrink-0" aria-hidden />
      </div>

      <div className="divide-y divide-line">
        {sets.map((set, index) => (
          <SetRow
            key={set.id}
            set={set}
            index={index}
            exercise={exercise}
            previous={placeholderAt(index)}
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
            showRpe={showRpe}
            isRecord={recordSetIds.has(set.id)}
            onChange={(patch) => onSetChange(set.id, patch)}
            onDelete={() => onDeleteSet(set.id)}
            onConfirmPlaceholder={() => onConfirmPlaceholder(set.id)}
            onDuplicate={() => onDuplicateSet(set.id)}
          />
        ))}
      </div>

      <button
        onClick={onAddSet}
        className="flex w-full items-center gap-1.5 border-t border-line px-4 py-3 text-[14px] font-semibold text-accent active:bg-accent-wash"
      >
        <Plus size={16} />
        Add set
      </button>
        </>
      )}
    </Card>
  )
}

/**
 * A one-line convention hint, so logging is unambiguous where it commonly isn't:
 * for a dumbbell lift, enter the weight of **one** dumbbell, not the pair. (The
 * "per side" note was dropped — it read as more confusing than helpful.)
 */
function loggingHint(exercise: Exercise, weightUnit: WeightUnit): string | null {
  if (exercise.equipment === 'dumbbell') return `Enter one dumbbell’s ${weightUnit}`
  return null
}

/**
 * Column headings matching whatever inputs `trackingType` produces. Kept beside
 * the layout switch in SetRow — if one changes, so must the other.
 */
function columnLabels(
  exercise: Exercise,
  weightUnit: WeightUnit,
  distanceUnit: DistanceUnit,
): string[] {
  switch (exercise.trackingType) {
    case 'weight_reps':
      return [weightUnit, 'reps']
    case 'bodyweight_reps':
    case 'reps_only':
      return ['reps']
    case 'weighted_bodyweight':
      return [`+${weightUnit}`, 'reps']
    case 'assisted_bodyweight':
      return [`−${weightUnit}`, 'reps']
    case 'time':
      return ['time']
    case 'distance_time':
      return ['time', distanceUnit]
    case 'weight_time':
      return [weightUnit, 'time']
  }
}

/** The one-line summary: date, sets × reps, best e1RM. */
function summarizeLastSession(
  lastPerformance: LastPerformance | undefined,
  weightUnit: WeightUnit,
  distanceUnit: DistanceUnit,
): string {
  const session = lastPerformance?.sessions[0]
  if (!session) return 'First time — no history yet'

  const working = session.sets
  if (working.length === 0) return formatRelativeDay(session.performedAt)

  const when = formatRelativeDay(session.performedAt)

  // Cardio reads as distance and time, not sets and reps.
  const first = working[0]!
  if (first.durationSeconds !== null) {
    const totalSeconds = working.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0)
    const totalMeters = working.reduce((sum, s) => sum + (s.distanceM ?? 0), 0)
    const parts = [formatDuration(totalSeconds)]
    if (totalMeters > 0) {
      const distance = distanceUnit === 'km' ? totalMeters / 1000 : totalMeters / 1609.344
      parts.push(`${distance.toFixed(2)} ${distanceUnit}`)
    }
    return `Last: ${when} · ${parts.join(' · ')}`
  }

  const reps = working.map((s) => s.reps).filter((r): r is number => r !== null)
  const weights = working.map((s) => s.weightKg).filter((w): w is number => w !== null)
  const repRange =
    reps.length === 0
      ? ''
      : Math.min(...reps) === Math.max(...reps)
        ? `${reps[0]}`
        : `${Math.min(...reps)}-${Math.max(...reps)}`

  const pieces = [`Last: ${when}`]
  if (repRange) {
    const weightPart =
      weights.length > 0
        ? ` @ ${weightFromKg(Math.max(...weights), weightUnit)}${weightUnit}`
        : ''
    pieces.push(`${working.length}×${repRange}${weightPart}`)
  }
  if (session.bestE1rmKg !== null) {
    pieces.push(`e1RM ${convertWeight(session.bestE1rmKg, weightUnit)}`)
  }
  return pieces.join(' · ')
}
