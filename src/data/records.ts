import { db, syncStamp } from '@/db/database'
import { getActiveUserId } from '@/db/seed'
import {
  type Equipment,
  type Exercise,
  type LastPerformance,
  type LoadMode,
  type PerformedSession,
  type PerformedSet,
  type PersonalRecord,
  type RecordType,
  type Workout,
  type WorkoutExercise,
  type WorkoutSet,
} from '@/domain/types'
import {
  bestEffectiveOneRepMaxKg,
  effectiveWeightKg,
  estimatedOneRepMaxKg,
  volumeLoadKg,
} from '@/lib/metrics'
import { WEEK_MS } from '@/lib/dates'
import { listSets } from './sets'
import { listWorkoutExercises } from './workouts'

// The records that mean a lift "got stronger". "Stalled" keys off these so a raw
// weight/rep PR isn't reported as stalled just because estimated-1RM didn't move.
export const PROGRESS_RECORD_TYPES: readonly RecordType[] = [
  'max_weight',
  'max_est_1rm',
  'max_reps_any_weight',
]

export interface StalledLift {
  exerciseId: string
  name: string
  weeksStalled: number
  lastProgressAt: number
}

// Per exercise, weeks since it last set ANY progress record, most-stalled first.
// One definition shared with the PR system, so "stalled" and "new PR" can't disagree.
export async function listStalledLifts(
  minWeeks = 2,
  now = Date.now(),
): Promise<StalledLift[]> {
  const progressTypes = new Set<RecordType>(PROGRESS_RECORD_TYPES)
  const lastProgressByExercise = new Map<string, number>()
  for (const pr of await db.personalRecords.toArray()) {
    if (pr.deletedAt !== null || !progressTypes.has(pr.recordType)) continue
    const prev = lastProgressByExercise.get(pr.exerciseId) ?? 0
    if (pr.achievedAt > prev) lastProgressByExercise.set(pr.exerciseId, pr.achievedAt)
  }

  const rows: StalledLift[] = []
  for (const [exerciseId, lastProgressAt] of lastProgressByExercise) {
    const weeksStalled = Math.floor((now - lastProgressAt) / WEEK_MS)
    if (weeksStalled < minWeeks) continue
    const exercise = await db.exercises.get(exerciseId)
    if (!exercise || exercise.isArchived) continue
    rows.push({ exerciseId, name: exercise.name, weeksStalled, lastProgressAt })
  }
  return rows.sort((a, b) => b.weeksStalled - a.weeksStalled)
}

export async function previewRecords(
  exerciseId: string,
  equipment: Equipment,
  // The current instance's load mode + the session's bodyweight, so a bodyweight
  // movement's weight/e1RM compare on effective load, same as the stored records.
  loadMode: LoadMode | null,
  bodyweightKg: number | null,
  candidate: Pick<WorkoutSet, 'weightKg' | 'reps' | 'durationSeconds' | 'distanceM'> & {
    id?: string
  },
): Promise<RecordType[]> {
  const exercise = await db.exercises.get(exerciseId)
  if (!exercise) return []
  const { history, siblings } = await recordBars(exercise, equipment, candidate.id)
  const effective = effectiveWeightKg(candidate, exercise, bodyweightKg, loadMode)

  const broken: RecordType[] = []
  for (const [type, value] of perSetRecordValues(candidate, effective)) {
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

// `weightForRecords` is the value the weight/e1RM records compare on: the raw
// entered weight for loaded lifts, but the effective load (bodyweight ± entered)
// for bodyweight movements, so a bodyweight/weighted/assisted dip rank on one scale.
function perSetRecordValues(
  set: Pick<WorkoutSet, 'reps' | 'durationSeconds' | 'distanceM'>,
  weightForRecords: number | null,
): [RecordType, number | null][] {
  return [
    ['max_weight', weightForRecords],
    ['max_reps_any_weight', set.reps],
    ['max_est_1rm', estimatedOneRepMaxKg(weightForRecords, set.reps)],
    ['max_duration', set.durationSeconds],
    ['max_distance', set.distanceM],
  ]
}

// A PR is measured against previous sessions, never against earlier sets of the same
// session. `history` is the best of every other session; `siblings` the best of the
// set's own session, excluding itself. With no `setId`, every session is history.

async function recordBars(
  exercise: Exercise,
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

  for (const { workout, workoutExercise, sets } of await completedSessionsForExercise(
    exercise.id,
    equipment,
  )) {
    const isOwnSession = ownWorkoutId !== undefined && workout.id === ownWorkoutId
    const into = isOwnSession ? siblings : history
    for (const candidate of sets) {
      if (candidate.id === setId) continue
      const effective = effectiveWeightKg(
        candidate,
        exercise,
        workout.bodyweightKg,
        workoutExercise.loadMode,
      )
      for (const [type, value] of perSetRecordValues(candidate, effective)) {
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

  for (const { workout, workoutExercise, sets } of await completedSessionsForExercise(
    exerciseId,
    equipment,
  )) {
    const at = workout.startedAt

    for (const set of sets) {
      const effective = effectiveWeightKg(
        set,
        exercise,
        workout.bodyweightKg,
        workoutExercise.loadMode,
      )
      for (const [type, value] of perSetRecordValues(set, effective)) {
        consider(type, value, at, set.id)
      }
    }

    const sessionVolume = volumeLoadKg(
      sets,
      exercise,
      workout.bodyweightKg,
      workoutExercise.loadMode,
    )
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
  const we = await db.workoutExercises.get(triggering.workoutExerciseId)
  const workout = we ? await db.workouts.get(we.workoutId) : undefined

  // The glow rule verbatim, so toast and green row can't disagree; max_volume_session is left out (it grows every set).
  return previewRecords(
    exerciseId,
    equipment,
    we?.loadMode ?? null,
    workout?.bodyweightKg ?? null,
    triggering,
  )
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

  const { loadMode } = previous.workoutExercise
  const bw = previous.workout.bodyweightKg
  return {
    workoutId: previous.workout.id,
    performedAt: previous.workout.startedAt,
    sets: previous.sets.map(toPlaceholderSet),
    bestE1rmKg: bestEffectiveE1rmKg(previous.sets, exercise, bw, loadMode),
    volumeKg: volumeLoadKg(previous.sets, exercise, bw, loadMode),
  }
}

// Kept as a thin alias for the canonical helper in lib/metrics, so existing
// callers keep their name while the implementation lives in one place.
export function bestEffectiveE1rmKg(
  sets: WorkoutSet[],
  exercise: Pick<Exercise, 'trackingType' | 'bodyweightFactor'>,
  bodyweightKg: number | null,
  loadMode: LoadMode | null,
): number | null {
  return bestEffectiveOneRepMaxKg(sets, exercise, bodyweightKg, loadMode)
}

export async function rebuildLastPerformance(
  exerciseId: string,
  equipment: Equipment,
): Promise<void> {
  const exercise = await db.exercises.get(exerciseId)
  if (!exercise) return

  const sessions: PerformedSession[] = (
    await completedSessionsForExercise(exerciseId, equipment)
  ).map(({ workout, workoutExercise, sets }) => ({
    workoutId: workout.id,
    performedAt: workout.startedAt,
    sets: sets.map(toPlaceholderSet),
    bestE1rmKg: bestEffectiveE1rmKg(
      sets,
      exercise,
      workout.bodyweightKg,
      workoutExercise.loadMode,
    ),
    volumeKg: volumeLoadKg(sets, exercise, workout.bodyweightKg, workoutExercise.loadMode),
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
