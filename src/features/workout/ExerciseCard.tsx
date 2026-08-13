import { useEffect, useMemo, useState } from 'react'
import { GripVertical, MoreHorizontal, Plus, StickyNote } from 'lucide-react'
import { Card } from '@/components/Card'
import * as repo from '@/data/repository'
import { cn } from '@/lib/cn'
import { formatRelativeDay } from '@/lib/dates'
import { displayWeight, distanceFromM, formatDuration, weightFromKg } from '@/lib/units'
import type {
  DistanceUnit,
  Exercise,
  Muscle,
  PerformedSession,
  PerformedSet,
  WeightUnit,
  WorkoutSet,
} from '@/domain/types'
import { regionVar } from '@/lib/palette'
import { CardioEntry } from './CardioEntry'
import { SetRow, hasLoggedValues } from './SetRow'
import { hasValue, resolvePlaceholders } from './resolvePlaceholders'
import { isCardioPattern } from '@/domain/movement'

export interface SetPlaceholderHint {
  weightKg: number | null
  reps: number | null
  durationSeconds: number | null
  distanceM: number | null
}

export interface ExerciseCardProps {
  exercise: Exercise
  muscle: Muscle | undefined
  sets: WorkoutSet[]
  // The session immediately before the one being viewed, so an older workout
  // never shows numbers from a newer one.
  previousSession: PerformedSession | null
  weightUnit: WeightUnit
  distanceUnit: DistanceUnit
  showRpe: boolean
  supersetGroup: number | null
  sessionNote: string
  // Per-set hints from a "do this again" copy (§7.2), keyed by set id; win over history.
  placeholderOverrides: Record<string, PerformedSet | SetPlaceholderHint>
  onAddSet: () => void
  onSetChange: (setId: string, patch: Partial<WorkoutSet>) => void
  onDeleteSet: (setId: string) => void
  onConfirmPlaceholder: (setId: string, shown: SetPlaceholderHint | undefined) => void
  onDuplicateSet: (setId: string) => void
  onOpenDetail: () => void
}

export function ExerciseCard(props: ExerciseCardProps) {
  const {
    exercise,
    muscle,
    sets,
    previousSession,
    weightUnit,
    distanceUnit,
    showRpe,
    supersetGroup,
    sessionNote,
    placeholderOverrides,
    onAddSet,
    onSetChange,
    onDeleteSet,
    onConfirmPlaceholder,
    onDuplicateSet,
    onOpenDetail,
  } = props

  const [recordSetIds, setRecordSetIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const matches = new Set<string>()
      for (const set of sets) {
        if (!hasLoggedValues(set, exercise)) continue
        // Pass the whole set (id included) so a row already holding the record
        // isn't compared against itself and stops glowing.
        const broken = await repo.previewRecords(exercise.id, set)
        if (broken.length > 0) matches.add(set.id)
      }
      if (!cancelled) setRecordSetIds(matches)
    })()
    return () => {
      cancelled = true
    }
  }, [sets, exercise])

  const isCardio = isCardioPattern(exercise.movementPattern)

  const previousSets = useMemo<PerformedSet[]>(
    () => previousSession?.sets ?? [],
    [previousSession],
  )

  const placeholderFor = useMemo<(PerformedSet | undefined)[]>(
    () => resolvePlaceholders(sets, placeholderOverrides, previousSets),
    [sets, placeholderOverrides, previousSets],
  )

  function placeholderAt(index: number): PerformedSet | undefined {
    const candidate = placeholderFor[index]
    return candidate && hasValue(candidate) ? candidate : undefined
  }

  return (
    <Card
      className={cn(
        'overflow-hidden',
        supersetGroup !== null && 'border-l-[3px] border-l-accent',
      )}
    >
      <div className="flex items-start gap-1 px-2.5 pt-3 pb-1">
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
            {summarizeLastSession(previousSession, weightUnit, distanceUnit)}
          </p>
          {loggingHint(exercise, weightUnit) && (
            <p className="mt-0.5 text-[11.5px] text-ink-muted">
              {loggingHint(exercise, weightUnit)}
            </p>
          )}
          {(sessionNote.trim() !== '' || exercise.notes.trim() !== '') && (
            <button
              onClick={onOpenDetail}
              className="mt-1.5 block w-full text-left"
              aria-label="Edit notes"
            >
              {sessionNote.trim() !== '' && (
                <span className="flex gap-1.5 text-[12px] leading-snug text-ink-secondary">
                  <StickyNote size={12} className="mt-0.5 shrink-0 text-accent" />
                  <span className="min-w-0">{sessionNote}</span>
                </span>
              )}
              {exercise.notes.trim() !== '' && (
                <span className="mt-0.5 flex gap-1.5 text-[12px] leading-snug text-ink-muted">
                  <StickyNote size={12} className="mt-0.5 shrink-0" />
                  <span className="min-w-0">{exercise.notes}</span>
                </span>
              )}
            </button>
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
                lastSession={previousSets[index]}
                weightUnit={weightUnit}
                distanceUnit={distanceUnit}
                showRpe={showRpe}
                isRecord={recordSetIds.has(set.id)}
                onChange={(patch) => onSetChange(set.id, patch)}
                onDelete={() => onDeleteSet(set.id)}
                onConfirmPlaceholder={() =>
                  onConfirmPlaceholder(set.id, placeholderAt(index))
                }
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

function loggingHint(exercise: Exercise, weightUnit: WeightUnit): string | null {
  if (exercise.equipment === 'dumbbell') return `Enter one dumbbell’s ${weightUnit}`
  return null
}

// Must stay in sync with the layout switch in SetRow's inputLayoutFor.
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

function summarizeLastSession(
  session: PerformedSession | null,
  weightUnit: WeightUnit,
  distanceUnit: DistanceUnit,
): string {
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
      const distance = distanceFromM(totalMeters, distanceUnit)
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
    pieces.push(`e1RM ${displayWeight(session.bestE1rmKg, weightUnit)}`)
  }
  return pieces.join(' · ')
}
