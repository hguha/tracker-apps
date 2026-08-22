import { db, syncStamp } from '@/db/database'
import { getActiveUserId } from '@/db/seed'
import { patternForRegion } from '@/domain/movement'
import {
  type Equipment,
  type Exercise,
  type PersonalRecord,
  type Region,
  type WorkoutSet,
} from '@/domain/types'
import { volumeLoadKg } from '@/lib/metrics'
import { enqueue, newId, patchRow } from './outbox'
import {
  bestEffectiveE1rmKg,
  completedSessionsForExercise,
  listPersonalRecords,
  rebuildLastPerformance,
  refreshPersonalRecords,
} from './records'
import { updateTemplateExercise } from './templates'
import { listWorkoutExercises, updateWorkoutExercise } from './workouts'

export async function listExercises(): Promise<Exercise[]> {
  const all = await db.exercises.toArray()
  return all
    .filter((e) => e.deletedAt === null && !e.isArchived)
    .sort((a, b) => a.name.localeCompare(b.name))
}

// A single exercise by id (archived/deleted included — callers resolving a logged
// row need it regardless of visibility). The repository read behind UI lookups so
// features don't reach into Dexie directly.
export async function getExercise(id: string): Promise<Exercise | undefined> {
  return db.exercises.get(id)
}

export interface NewExerciseInput {
  name: string
  region: Region
  trackingType: Exercise['trackingType']
  bodyweightFactor?: number | null
  notes?: string
  defaultRestSeconds?: number | null
}

export async function createExercise(input: NewExerciseInput): Promise<string> {
  const name = input.name.trim()
  const exercise: Exercise = {
    id: newId(),
    userId: getActiveUserId(),
    name,
    region: input.region,
    aliases: [],
    // Derived from the region rather than asked for (§4.3).
    movementPattern: patternForRegion(input.region),
    trackingType: input.trackingType,
    bodyweightFactor: input.bodyweightFactor ?? null,
    isKeyLift: false,
    notes: input.notes ?? '',
    defaultRestSeconds: input.defaultRestSeconds ?? null,
    isArchived: false,
    ...syncStamp(),
  }
  await db.exercises.add(exercise)
  await enqueue('exercises', exercise.id)
  return exercise.id
}

// Fork-on-edit for the read-only system library: RLS lets a user write only their
// own rows, so editing a built-in exercise clones it into a user-owned copy,
// repoints this user's history/templates to the clone, archives the original
// locally, and moves its records/last-time over. Editing an owned row is a plain
// in-place update. Returns the id to keep editing (the clone's, when forked).

export async function saveExerciseEdits(
  id: string,
  patch: Pick<Exercise, 'name' | 'region' | 'trackingType' | 'notes'> &
    Partial<Pick<Exercise, 'bodyweightFactor' | 'defaultRestSeconds'>>,
): Promise<string> {
  const existing = await db.exercises.get(id)
  if (!existing) return id

  const movementPattern = patternForRegion(patch.region)

  if (existing.userId !== null) {
    await updateExercise(id, { ...patch, movementPattern })
    return id
  }

  const clone: Exercise = {
    ...existing,
    ...patch,
    id: newId(),
    userId: getActiveUserId(),
    movementPattern,
    ...syncStamp(),
  }
  await db.exercises.add(clone)
  await enqueue('exercises', clone.id)

  await repointExerciseReferences(id, clone.id)
  // Hide the shared original for this device; system rows can't sync a change.
  await db.exercises.update(id, { isArchived: true })
  return clone.id
}

// Soft-deletes a custom exercise (syncs via the deletedAt tombstone). History keeps
// the row reference, so past workouts still show the name. Only user-owned rows —
// system library rows are shared and RLS-protected.

export async function deleteExercise(id: string): Promise<void> {
  const exercise = await db.exercises.get(id)
  if (!exercise || exercise.userId === null) return
  await patchRow(db.exercises, 'exercises', id, { deletedAt: Date.now() })
}

// Repoints this user's workout/template exercises from one exercise id to another
// and rebuilds the affected per-(exercise+equipment) caches. Used by fork-on-edit.

async function repointExerciseReferences(fromId: string, toId: string): Promise<void> {
  const pairs = new Set<Equipment>()
  const wes = await db.workoutExercises.where('exerciseId').equals(fromId).toArray()
  for (const we of wes) {
    await updateWorkoutExercise(we.id, { exerciseId: toId })
    pairs.add(we.equipment)
  }
  const tes = (await db.templateExercises.toArray()).filter(
    (te) => te.exerciseId === fromId,
  )
  for (const te of tes) {
    await updateTemplateExercise(te.id, { exerciseId: toId })
  }
  for (const equipment of pairs) {
    await rebuildLastPerformance(toId, equipment)
    await refreshPersonalRecords(toId, equipment)
  }
}

export async function updateExercise(
  id: string,
  patch: Partial<Exercise>,
): Promise<void> {
  await patchRow(db.exercises, 'exercises', id, patch)
}

export interface ExerciseDetail {
  exercise: Exercise
  records: PersonalRecord[]
  sessions: {
    workoutId: string
    performedAt: number
    sets: WorkoutSet[]
    volumeKg: number
    bestE1rmKg: number | null
  }[]
  lastTrainedAt: number | null
}

export async function getExerciseDetail(
  exerciseId: string,
): Promise<ExerciseDetail | null> {
  const exercise = await db.exercises.get(exerciseId)
  if (!exercise) return null

  const sessions: ExerciseDetail['sessions'] = (
    await completedSessionsForExercise(exerciseId)
  ).map(({ workout, workoutExercise, sets }) => ({
    workoutId: workout.id,
    performedAt: workout.startedAt,
    sets,
    volumeKg: volumeLoadKg(sets, exercise, workout.bodyweightKg, workoutExercise.loadMode),
    bestE1rmKg: bestEffectiveE1rmKg(
      sets,
      exercise,
      workout.bodyweightKg,
      workoutExercise.loadMode,
    ),
  }))

  return {
    exercise,
    records: await listPersonalRecords(exerciseId),
    sessions,
    lastTrainedAt: sessions[0]?.performedAt ?? null,
  }
}

// The equipment last logged per movement, so a resolved plan matches how this user
// actually trains rather than falling back to a generic default.

export async function lastEquipmentMap(): Promise<Map<string, Equipment>> {
  const recent = (await db.workouts.orderBy('startedAt').reverse().limit(200).toArray())
    .filter((w) => w.deletedAt === null)
    .sort((a, b) => b.startedAt - a.startedAt)

  const lastEquipment = new Map<string, Equipment>()
  for (const workout of recent) {
    for (const we of await listWorkoutExercises(workout.id)) {
      if (!lastEquipment.has(we.exerciseId))
        lastEquipment.set(we.exerciseId, we.equipment)
    }
  }
  return lastEquipment
}

export async function getLastTrainedMap(): Promise<Map<string, number>> {
  const recent = (
    await db.workouts.orderBy('startedAt').reverse().limit(200).toArray()
  ).filter((w) => w.deletedAt === null)
  const startedAtById = new Map(recent.map((w) => [w.id, w.startedAt]))
  if (startedAtById.size === 0) return new Map()

  const rows = await db.workoutExercises
    .where('workoutId')
    .anyOf([...startedAtById.keys()])
    .toArray()

  const lastTrained = new Map<string, number>()
  for (const we of rows) {
    if (we.deletedAt !== null) continue
    const startedAt = startedAtById.get(we.workoutId)
    if (startedAt === undefined) continue
    const existing = lastTrained.get(we.exerciseId)
    if (existing === undefined || startedAt > existing) {
      lastTrained.set(we.exerciseId, startedAt)
    }
  }
  return lastTrained
}

