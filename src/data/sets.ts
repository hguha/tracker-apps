import { db, syncStamp } from '@/db/database'
import {
  type Equipment,
  type Exercise,
  type RecordType,
  type WeightUnit,
  type WorkoutSet,
} from '@/domain/types'
import { enqueue, newId, patchRow } from './outbox'
import { getLastPerformance, refreshPersonalRecords } from './records'
import { getPlaceholderOverrides } from './workouts'

export async function listSets(workoutExerciseId: string): Promise<WorkoutSet[]> {
  const rows = await db.sets
    .where('workoutExerciseId')
    .equals(workoutExerciseId)
    .toArray()
  return rows.filter((r) => r.deletedAt === null).sort((a, b) => a.position - b.position)
}

export async function getSet(id: string): Promise<WorkoutSet | undefined> {
  return db.sets.get(id)
}

export interface NewSetInput {
  workoutExerciseId: string
  weightKg?: number | null
  reps?: number | null
  durationSeconds?: number | null
  distanceM?: number | null
  isCompleted?: boolean
  enteredUnit?: WeightUnit | null
  afterPosition?: number
}

export async function addSet(input: NewSetInput): Promise<string> {
  const siblings = await listSets(input.workoutExerciseId)

  let position: number
  if (input.afterPosition === undefined) {
    // One past the highest, not the count — deleting set 2 of 3 would otherwise reuse position 2.
    position = siblings.reduce((max, s) => Math.max(max, s.position), -1) + 1
  } else {
    position = input.afterPosition + 1
    for (const sibling of siblings) {
      if (sibling.position >= position) {
        await updateSet(sibling.id, { position: sibling.position + 1 })
      }
    }
  }

  const set: WorkoutSet = {
    id: newId(),
    workoutExerciseId: input.workoutExerciseId,
    position,
    setType: 'normal',
    weightKg: input.weightKg ?? null,
    reps: input.reps ?? null,
    repsLeft: null,
    repsRight: null,
    durationSeconds: input.durationSeconds ?? null,
    distanceM: input.distanceM ?? null,
    rpe: null,
    rir: null,
    restTakenSeconds: null,
    isCompleted: input.isCompleted ?? false,
    completedAt: input.isCompleted ? Date.now() : null,
    notes: '',
    enteredUnit: input.enteredUnit ?? null,
    ...syncStamp(),
  }
  await db.sets.add(set)
  await enqueue('sets', set.id)
  return set.id
}

export async function updateSet(id: string, patch: Partial<WorkoutSet>): Promise<void> {
  await patchRow(db.sets, 'sets', id, patch)
}

export async function deleteSet(id: string): Promise<void> {
  await patchRow(db.sets, 'sets', id, { deletedAt: Date.now() })
}

export async function restoreSet(id: string): Promise<void> {
  await patchRow(db.sets, 'sets', id, { deletedAt: null })
}

// Writes values to a set and derives its completion (§6.2): a set with values is
// performed, one without is a placeholder. Returns any records the values just broke.

export async function logSetValues(
  id: string,
  values: Partial<WorkoutSet>,
): Promise<RecordType[]> {
  const current = await db.sets.get(id)
  if (!current) return []
  const workoutExercise = await db.workoutExercises.get(current.workoutExerciseId)
  if (!workoutExercise) return []
  const exercise = await db.exercises.get(workoutExercise.exerciseId)
  if (!exercise) return []

  const merged = { ...current, ...values }
  const isCompleted = setHasValues(merged, exercise)

  await updateSet(id, {
    ...values,
    isCompleted,
    completedAt: isCompleted ? (current.completedAt ?? Date.now()) : null,
  })

  return refreshPersonalRecords(workoutExercise.exerciseId, workoutExercise.equipment, id)
}

// Must mirror the UI's per-tracking-type field layout, or a set can look logged on screen yet be absent from every metric.

export function setHasValues(
  set: Pick<WorkoutSet, 'reps' | 'weightKg' | 'durationSeconds' | 'distanceM'>,
  exercise: Pick<Exercise, 'trackingType'>,
): boolean {
  switch (exercise.trackingType) {
    case 'weight_reps':
    case 'bodyweight_reps':
    case 'reps_only':
      return set.reps !== null
    case 'time':
      return set.durationSeconds !== null
    case 'distance_time':
      return set.durationSeconds !== null || set.distanceM !== null
    case 'weight_time':
      return set.durationSeconds !== null || set.weightKg !== null
  }
}

// Copies the ghost values into a set — the "same as last time" action. `shown` is
// what the row is displaying; callers without a rendered row fall back to derivation.

export async function confirmPlaceholder(
  setId: string,
  shown?: SetPlaceholder,
): Promise<RecordType[]> {
  const set = await db.sets.get(setId)
  if (!set) return []
  const workoutExercise = await db.workoutExercises.get(set.workoutExerciseId)
  if (!workoutExercise) return []

  let prefill = shown ?? null

  if (!prefill) {
    // A repeated session stores per-set placeholder overrides that win over history (§7.2).
    const overrides = await getPlaceholderOverrides(workoutExercise.workoutId)
    prefill = overrides[setId] ?? null
  }

  if (!prefill) {
    const siblings = await listSets(set.workoutExerciseId)
    const index = siblings.findIndex((s) => s.id === setId)
    prefill = await getPrefillForSet(
      workoutExercise.exerciseId,
      workoutExercise.equipment,
      index < 0 ? 0 : index,
      siblings,
    )
  }
  if (!prefill || !hasAnyValue(prefill)) return []

  return logSetValues(setId, {
    weightKg: prefill.weightKg,
    reps: prefill.reps,
    durationSeconds: prefill.durationSeconds,
    distanceM: prefill.distanceM,
  })
}

function hasAnyValue(v: SetPlaceholder): boolean {
  return (
    v.weightKg !== null ||
    v.reps !== null ||
    v.durationSeconds !== null ||
    v.distanceM !== null
  )
}

// Which record types the given values would beat, without writing (§6.2). Measured
// against previous sessions only, like refreshPersonalRecords, so glow and toast agree.

export interface SetPlaceholder {
  weightKg: number | null
  reps: number | null
  durationSeconds: number | null
  distanceM: number | null
}

// Placeholder values for a set row (§6.2), by precedence: same set index from the
// latest session, else the last logged set of this session, else the previous session's
// final set, else nothing.

export async function getPrefillForSet(
  exerciseId: string,
  equipment: Equipment,
  setIndex: number,
  currentSessionSets?: WorkoutSet[],
): Promise<SetPlaceholder | null> {
  const cache = await getLastPerformance(exerciseId, equipment)
  const history = (cache?.sessions[0]?.sets ?? []).filter(() => true)

  const fromHistory = history[setIndex]
  if (fromHistory) {
    return {
      weightKg: fromHistory.weightKg,
      reps: fromHistory.reps,
      durationSeconds: fromHistory.durationSeconds,
      distanceM: fromHistory.distanceM,
    }
  }

  const loggedThisSession = (currentSessionSets ?? []).filter((s) => s.isCompleted)
  const lastThisSession = loggedThisSession[loggedThisSession.length - 1]
  if (lastThisSession) {
    return {
      weightKg: lastThisSession.weightKg,
      reps: lastThisSession.reps,
      durationSeconds: lastThisSession.durationSeconds,
      distanceM: lastThisSession.distanceM,
    }
  }

  const lastFromHistory = history[history.length - 1]
  if (lastFromHistory) {
    return {
      weightKg: lastFromHistory.weightKg,
      reps: lastFromHistory.reps,
      durationSeconds: lastFromHistory.durationSeconds,
      distanceM: lastFromHistory.distanceM,
    }
  }

  return null
}

// Adds an empty set; its placeholder is resolved live by the exercise card (§6.2), so nothing is persisted here.

export async function addSetWithPlaceholder(
  workoutExerciseId: string,
  _exerciseId: string,
): Promise<{ setId: string }> {
  const setId = await addSet({ workoutExerciseId })
  return { setId }
}

// ----- templates -----
