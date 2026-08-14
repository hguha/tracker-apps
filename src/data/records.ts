import { db, syncStamp } from '@/db/database'
import { getActiveUserId } from '@/db/seed'
import {
  type Equipment,
  type LastPerformance,
  type PerformedSession,
  type PerformedSet,
  type PersonalRecord,
  type RecordType,
  type Workout,
  type WorkoutExercise,
  type WorkoutSet,
} from '@/domain/types'
import { bestOneRepMaxKg, estimatedOneRepMaxKg, volumeLoadKg } from '@/lib/metrics'
import { listSets } from './sets'
import { listWorkoutExercises } from './workouts'

export async function previewRecords(
  exerciseId: string,
  equipment: Equipment,
  candidate: Pick<WorkoutSet, 'weightKg' | 'reps' | 'durationSeconds' | 'distanceM'> & {
    id?: string
  },
): Promise<RecordType[]> {
  const { history, siblings } = await recordBars(exerciseId, equipment, candidate.id)

  const broken: RecordType[] = []
  for (const [type, value] of perSetRecordValues(candidate)) {
    if (!isRecordValue(value)) continue
    // No previous session to beat means no record — keeps a first-ever exercise quiet.
    const previous = history.get(type)
    if (previous === undefined) continue
    // Beat history *and* every sibling, so only the session's best row glows.
    if (value > Math.max(previous, siblings.get(type) ?? 0)) broken.push(type)
  }

  return broken
}

function isRecordValue(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0
}

// The record types a single set can hold. `max_volume_session` is absent by design: it's a session aggregate, not a per-set property.

function perSetRecordValues(
  set: Pick<WorkoutSet, 'weightKg' | 'reps' | 'durationSeconds' | 'distanceM'>,
): [RecordType, number | null][] {
  return [
    ['max_weight', set.weightKg],
    ['max_reps_any_weight', set.reps],
    ['max_est_1rm', estimatedOneRepMaxKg(set.weightKg, set.reps)],
    ['max_duration', set.durationSeconds],
    ['max_distance', set.distanceM],
  ]
}

// A PR is measured against previous sessions, never against earlier sets of the same
// session. `history` is the best of every other session; `siblings` the best of the
// set's own session, excluding itself. With no `setId`, every session is history.

async function recordBars(
  exerciseId: string,
  equipment: Equipment,
  setId: string | undefined,
): Promise<{ history: Map<RecordType, number>; siblings: Map<RecordType, number> }> {
  const set = setId === undefined ? undefined : await db.sets.get(setId)
  const ownWorkoutId =
    set === undefined
      ? undefined
      : (await db.workoutExercises.get(set.workoutExerciseId))?.workoutId

  const history = new Map<RecordType, number>()
  const siblings = new Map<RecordType, number>()

  for (const { workout, sets } of await completedSessionsForExercise(
    exerciseId,
    equipment,
  )) {
    const isOwnSession = ownWorkoutId !== undefined && workout.id === ownWorkoutId
    const into = isOwnSession ? siblings : history
    for (const candidate of sets) {
      if (candidate.id === setId) continue
      for (const [type, value] of perSetRecordValues(candidate)) {
        if (!isRecordValue(value)) continue
        const previous = into.get(type)
        if (previous === undefined || value > previous) into.set(type, value)
      }
    }
  }

  return { history, siblings }
}

// Live sessions containing one exercise, newest first, with their completed sets.
// When `equipment` is given, only sessions logged with that equipment count, so
// records and last-time stay per (exercise + equipment).

export async function completedSessionsForExercise(
  exerciseId: string,
  equipment?: Equipment,
): Promise<
  {
    workout: Workout
    workoutExercise: WorkoutExercise
    sets: WorkoutSet[]
  }[]
> {
  const workoutExercises = (
    await db.workoutExercises.where('exerciseId').equals(exerciseId).toArray()
  ).filter(
    (we) =>
      we.deletedAt === null && (equipment === undefined || we.equipment === equipment),
  )

  const sessions: {
    workout: Workout
    workoutExercise: WorkoutExercise
    sets: WorkoutSet[]
  }[] = []

  for (const workoutExercise of workoutExercises) {
    const workout = await db.workouts.get(workoutExercise.workoutId)
    if (!workout || workout.deletedAt !== null) continue
    const sets = (await listSets(workoutExercise.id)).filter((s) => s.isCompleted)
    if (sets.length === 0) continue
    sessions.push({ workout, workoutExercise, sets })
  }

  return sessions.sort((a, b) => b.workout.startedAt - a.workout.startedAt)
}

// ----- personal records -----

// Recomputes every record for one exercise from scratch; full recomputation, not
// incremental, because editing a past workout can invalidate a record (§6.6). Returns
// the types `triggeringSetId` claimed; with no triggering set nothing is announced.

export async function refreshPersonalRecords(
  exerciseId: string,
  equipment: Equipment,
  triggeringSetId?: string,
): Promise<RecordType[]> {
  const exercise = await db.exercises.get(exerciseId)
  if (!exercise) return []

  const candidates = new Map<RecordType, { value: number; at: number; setId: string }>()

  function consider(type: RecordType, value: number | null, at: number, setId: string) {
    if (!isRecordValue(value)) return
    const existing = candidates.get(type)
    if (!existing || value > existing.value) candidates.set(type, { value, at, setId })
  }

  for (const { workout, sets } of await completedSessionsForExercise(
    exerciseId,
    equipment,
  )) {
    const at = workout.startedAt

    for (const set of sets) {
      for (const [type, value] of perSetRecordValues(set)) {
        consider(type, value, at, set.id)
      }
    }

    const sessionVolume = volumeLoadKg(sets, exercise, workout.bodyweightKg)
    consider('max_volume_session', sessionVolume, at, sets[0]!.id)
  }

  // Replace wholesale for this (exercise + equipment), so a record that no longer
  // holds disappears without touching the other equipment's records.
  await db.personalRecords
    .where('[exerciseId+equipment]')
    .equals([exerciseId, equipment])
    .delete()
  const records: PersonalRecord[] = [...candidates].map(([recordType, best]) => ({
    id: `${exerciseId}:${equipment}:${recordType}`,
    userId: getActiveUserId(),
    exerciseId,
    equipment,
    recordType,
    value: best.value,
    achievedAt: best.at,
    setId: best.setId,
    ...syncStamp(),
  }))
  // bulkPut, not bulkAdd: the delete above should have cleared this pair's rows,
  // but an orphaned PR whose stored equipment disagrees with its id would survive
  // it and make bulkAdd throw ConstraintError. The ids are deterministic, so
  // overwriting is exactly right.
  if (records.length > 0) await db.personalRecords.bulkPut(records)

  if (triggeringSetId === undefined) return []
  const triggering = await db.sets.get(triggeringSetId)
  if (!triggering || !triggering.isCompleted) return []

  // The glow rule verbatim, so toast and green row can't disagree; max_volume_session is left out (it grows every set).
  return previewRecords(exerciseId, equipment, triggering)
}

// Every record for the base exercise, across all equipment.

export async function listPersonalRecords(exerciseId: string): Promise<PersonalRecord[]> {
  return db.personalRecords.where('exerciseId').equals(exerciseId).toArray()
}

// A denormalized blob per (exercise + equipment) (§6.3), so the last-time header
// is one indexed lookup, not a scan.

export async function getLastPerformance(
  exerciseId: string,
  equipment: Equipment,
): Promise<LastPerformance | undefined> {
  return db.lastPerformance.get(`${exerciseId}:${equipment}`)
}

// The most recent session strictly before the given workout — the `Last` column while
// it's open. Can't use the lastPerformance cache (globally-newest) or "last time" would
// point forward. Workout id breaks a same-millisecond tie so ordering stays deterministic.

export async function getPreviousSession(
  exerciseId: string,
  equipment: Equipment,
  beforeWorkoutId: string,
): Promise<PerformedSession | null> {
  const anchor = await db.workouts.get(beforeWorkoutId)
  if (!anchor) return null

  const exercise = await db.exercises.get(exerciseId)
  if (!exercise) return null

  const earlier = (await completedSessionsForExercise(exerciseId, equipment)).filter(
    ({ workout }) =>
      workout.id !== beforeWorkoutId &&
      (workout.startedAt < anchor.startedAt ||
        (workout.startedAt === anchor.startedAt && workout.id < anchor.id)),
  )
  const previous = earlier[0]
  if (!previous) return null

  return {
    workoutId: previous.workout.id,
    performedAt: previous.workout.startedAt,
    sets: previous.sets.map(toPlaceholderSet),
    bestE1rmKg: bestOneRepMaxKg(previous.sets),
    volumeKg: volumeLoadKg(previous.sets, exercise, previous.workout.bodyweightKg),
  }
}

export async function rebuildLastPerformance(
  exerciseId: string,
  equipment: Equipment,
): Promise<void> {
  const exercise = await db.exercises.get(exerciseId)
  if (!exercise) return

  const sessions: PerformedSession[] = (
    await completedSessionsForExercise(exerciseId, equipment)
  ).map(({ workout, sets }) => ({
    workoutId: workout.id,
    performedAt: workout.startedAt,
    sets: sets.map(toPlaceholderSet),
    bestE1rmKg: bestOneRepMaxKg(sets),
    volumeKg: volumeLoadKg(sets, exercise, workout.bodyweightKg),
  }))

  await db.lastPerformance.put({
    id: `${exerciseId}:${equipment}`,
    exerciseId,
    equipment,
    sessions: sessions.slice(0, 3),
    updatedAt: Date.now(),
  })
}

function toPlaceholderSet(s: WorkoutSet): PerformedSet {
  return {
    weightKg: s.weightKg,
    reps: s.reps,
    durationSeconds: s.durationSeconds,
    distanceM: s.distanceM,
    rpe: s.rpe,
  }
}

export async function rebuildLastPerformanceForWorkout(workoutId: string): Promise<void> {
  const workoutExercises = await listWorkoutExercises(workoutId)
  for (const we of workoutExercises) {
    await rebuildLastPerformance(we.exerciseId, we.equipment)
    await refreshPersonalRecords(we.exerciseId, we.equipment)
  }
}
