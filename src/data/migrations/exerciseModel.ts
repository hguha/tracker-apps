// One-time, boot-run data migrations for the exercise model (§4.3, §4.4), split
// out of data/exercises.ts. Wired into the launch chain in app/App.tsx; idempotent.

import { db, touch } from '@/db/database'
import { EXERCISE_MERGES, RETIRED_BASE_IDS, VARIANT_MAPPINGS } from '@/db/seed/bases'
import type {
  Equipment,
  LoadMode,
  TrackingType,
  WorkoutExercise,
} from '@/domain/types'
import { enqueue } from '../outbox'
import { rebuildLastPerformance, refreshPersonalRecords } from '../records'

// Scanned not indexed: IndexedDB can't index the null endedAt that "unfinished" means (§4.4).

export async function migrateToBaseExercises(): Promise<void> {
  const staleWe = await db.workoutExercises
    .filter((we) => (we as { equipment?: Equipment }).equipment === undefined)
    .count()
  const staleTe = await db.templateExercises
    .filter((te) => (te as { equipment?: Equipment }).equipment === undefined)
    .count()
  if (staleWe === 0 && staleTe === 0) return

  const variantToBase = new Map(VARIANT_MAPPINGS.map((m) => [m.oldId, m]))

  async function resolve(
    oldExerciseId: string,
  ): Promise<{ baseId: string; equipment: Equipment }> {
    const mapped = variantToBase.get(oldExerciseId)
    if (mapped) return { baseId: mapped.baseId, equipment: mapped.equipment }
    // Custom or unknown row keeps its own id; read its old scalar equipment.
    const legacy = (await db.exercises.get(oldExerciseId)) as
      | { equipment?: Equipment }
      | undefined
    return { baseId: oldExerciseId, equipment: legacy?.equipment ?? 'other' }
  }

  // Repoint workout + template exercises to (base, equipment).
  for (const we of await db.workoutExercises.toArray()) {
    if ((we as { equipment?: Equipment }).equipment !== undefined) continue
    const { baseId, equipment } = await resolve(we.exerciseId)
    await db.workoutExercises.update(we.id, {
      exerciseId: baseId,
      equipment,
      ...touch(we.clientRev),
    })
    const full = await db.workoutExercises.get(we.id)
    if (full) await enqueue('workoutExercises', full.id)
  }
  for (const te of await db.templateExercises.toArray()) {
    if ((te as { equipment?: Equipment }).equipment !== undefined) continue
    const { baseId, equipment } = await resolve(te.exerciseId)
    await db.templateExercises.update(te.id, {
      exerciseId: baseId,
      equipment,
      ...touch(te.clientRev),
    })
    const full = await db.templateExercises.get(te.id)
    if (full) await enqueue('templateExercises', full.id)
  }

  // Hide the retired equipment-named system rows locally (they can't sync a change).
  for (const { oldId, baseId } of VARIANT_MAPPINGS) {
    if (oldId === baseId) continue
    const row = await db.exercises.get(oldId)
    if (row && row.userId === null && !row.isArchived) {
      await db.exercises.update(oldId, { isArchived: true })
    }
  }

  // Rebuild the derived caches for every (exercise + equipment) now in history.
  await db.personalRecords.clear()
  await db.lastPerformance.clear()
  const pairs = new Set<string>()
  for (const we of await db.workoutExercises.toArray()) {
    if (we.deletedAt !== null) continue
    pairs.add(`${we.exerciseId}:${we.equipment}`)
  }
  await rebuildCachePairs(pairs)
}

// A base whose seed label got clearer changed id with it ('curl' → 'biceps_curl'),
// so history pointing at the old id has to follow or it orphans. Runs after
// seeding, which has already created the new row. A no-op once nothing refers to
// the old id.

export async function repointRetiredBaseExercises(): Promise<void> {
  const touched = new Set<string>()

  for (const [oldId, newId] of Object.entries(RETIRED_BASE_IDS)) {
    if ((await db.exercises.get(newId)) === undefined) continue

    for (const we of await db.workoutExercises
      .where('exerciseId')
      .equals(oldId)
      .toArray()) {
      await db.workoutExercises.update(we.id, {
        exerciseId: newId,
        ...touch(we.clientRev),
      })
      const full = await db.workoutExercises.get(we.id)
      if (full) {
        await enqueue('workoutExercises', full.id)
        touched.add(`${newId}:${full.equipment}`)
      }
    }

    for (const te of await db.templateExercises.toArray()) {
      if (te.exerciseId !== oldId) continue
      await db.templateExercises.update(te.id, {
        exerciseId: newId,
        ...touch(te.clientRev),
      })
      const full = await db.templateExercises.get(te.id)
      if (full) await enqueue('templateExercises', full.id)
    }

    // The old system row can't sync a change, so hide it locally instead.
    const stale = await db.exercises.get(oldId)
    if (stale && stale.userId === null && !stale.isArchived) {
      await db.exercises.update(oldId, { isArchived: true })
    }
    await db.personalRecords.where('exerciseId').equals(oldId).delete()
    await db.lastPerformance.where('exerciseId').equals(oldId).delete()
  }

  await rebuildCachePairs(touched)
}

// The retired bodyweight tracking types, kept only so the one-time migration and
// the backup importer can recognise and coerce rows that predate the collapse.
export const RETIRED_BODYWEIGHT_TRACKING = new Set([
  'weighted_bodyweight',
  'assisted_bodyweight',
])

function isBodyweightTracking(tracking: TrackingType | undefined): boolean {
  return tracking === 'bodyweight_reps' || RETIRED_BODYWEIGHT_TRACKING.has(tracking ?? '')
}

// Rebuilds the derived caches for a set of `${exerciseId}:${equipment}` pairs.
// Shared by every migration that repoints history, so the recompute lives once.
async function rebuildCachePairs(pairs: Iterable<string>): Promise<void> {
  for (const key of pairs) {
    const [exerciseId, equipment] = key.split(':') as [string, Equipment]
    await rebuildLastPerformance(exerciseId, equipment)
    await refreshPersonalRecords(exerciseId, equipment)
  }
}

// Persisted run-once marker: a data-shape guard can't detect the self-heal case (a
// row wrongly stamped 'bodyweight' that should be 'weighted'), so bound it by version.
const EXERCISE_MODEL_MIGRATED_KEY = 'fitnote.exercise-model-migrated'
// Bump to re-run once on already-migrated devices (v2 added the bodyweight backfill).
const EXERCISE_MODEL_MIGRATION_VERSION = '2'

function migrationApplied(key: string, version: string): boolean {
  try {
    return localStorage.getItem(key) === version
  } catch {
    return false
  }
}

/**
 * Moves the library onto the current exercise model, once (see the marker above):
 *  0. Backfill missing `workout.bodyweightKg` from the nearest measurement.
 *  1. Stamp `loadMode` on bodyweight rows — derived from logged weight (self-healing
 *     and immune to a sync pull flipping the tracking type mid-migration); assisted
 *     comes from the pre-collapse type, degrading to 'weighted' in the one gap.
 *  2. Merge duplicate movements (EXERCISE_MERGES) into their canonical base.
 *  3. Coerce retired bodyweight tracking types to `bodyweight_reps`.
 *  4. Rebuild caches for the (exercise + equipment) pairs actually changed.
 */
export async function migrateExerciseModel(): Promise<void> {
  if (migrationApplied(EXERCISE_MODEL_MIGRATED_KEY, EXERCISE_MODEL_MIGRATION_VERSION)) {
    return
  }

  const exercises = await db.exercises.toArray()
  const trackingOf = new Map(exercises.map((e) => [e.id, e.trackingType]))
  const assistedIds = new Set(
    exercises
      .filter((e) => (e.trackingType as string) === 'assisted_bodyweight')
      .map((e) => e.id),
  )
  const allWorkoutExercises = await db.workoutExercises.toArray()
  // The workout-exercises carrying an added/assist weight — the ground truth for
  // weighted-vs-bodyweight, gathered in one pass rather than a query per row.
  const weightedWeIds = new Set<string>()
  for (const set of await db.sets.toArray()) {
    if (set.deletedAt === null && set.weightKg !== null && set.weightKg !== 0) {
      weightedWeIds.add(set.workoutExerciseId)
    }
  }

  const touched = new Set<string>()

  // 0. Backfill missing session bodyweights from the nearest measurement, then
  //    mark the bodyweight lifts in those sessions for a cache rebuild.
  await backfillWorkoutBodyweight(allWorkoutExercises, trackingOf, touched)

  // The load mode a bodyweight row should carry, given what it currently has and
  // whether a weight was logged/targeted. Only ever called for bodyweight rows.
  const modeFor = (
    exerciseId: string,
    current: LoadMode | null | undefined,
    hasWeight: boolean,
  ): LoadMode => {
    if (current === 'assisted' || assistedIds.has(exerciseId)) return 'assisted'
    if (hasWeight) return 'weighted'
    return current ?? 'bodyweight'
  }

  // 1. Set loadMode on rows that predate the field: a bodyweight row's mode is
  //    derived from logged weight and pushed; a non-bodyweight row is just
  //    normalised absent→null locally (matches the server default, so no push).
  for (const we of allWorkoutExercises) {
    const current = (we as { loadMode?: LoadMode | null }).loadMode
    if (!isBodyweightTracking(trackingOf.get(we.exerciseId))) {
      if (current === undefined) await db.workoutExercises.update(we.id, { loadMode: null })
      continue
    }
    const desired = modeFor(we.exerciseId, current, weightedWeIds.has(we.id))
    if (desired !== current) {
      await db.workoutExercises.update(we.id, { loadMode: desired, ...touch(we.clientRev) })
      await enqueue('workoutExercises', we.id)
      touched.add(`${we.exerciseId}:${we.equipment}`)
    }
  }
  for (const te of await db.templateExercises.toArray()) {
    const current = (te as { loadMode?: LoadMode | null }).loadMode
    if (!isBodyweightTracking(trackingOf.get(te.exerciseId))) {
      if (current === undefined) await db.templateExercises.update(te.id, { loadMode: null })
      continue
    }
    const hasWeight = te.targetWeightKg !== null && te.targetWeightKg !== 0
    const desired = modeFor(te.exerciseId, current, hasWeight)
    if (desired !== current) {
      await db.templateExercises.update(te.id, { loadMode: desired, ...touch(te.clientRev) })
      await enqueue('templateExercises', te.id)
    }
  }

  // 2. Merge duplicate movements into their canonical base. Template rows are
  //    loaded once here (post step 1, so clientRev is current).
  const templateExercises = await db.templateExercises.toArray()
  for (const merge of EXERCISE_MERGES) {
    for (const we of await db.workoutExercises
      .where('exerciseId')
      .equals(merge.from)
      .toArray()) {
      const equipment = merge.equipment ?? we.equipment
      await db.workoutExercises.update(we.id, {
        exerciseId: merge.to,
        equipment,
        ...(merge.loadMode !== undefined ? { loadMode: merge.loadMode } : {}),
        ...touch(we.clientRev),
      })
      await enqueue('workoutExercises', we.id)
      touched.add(`${merge.to}:${equipment}`)
    }
    for (const te of templateExercises) {
      if (te.exerciseId !== merge.from) continue
      await db.templateExercises.update(te.id, {
        exerciseId: merge.to,
        equipment: merge.equipment ?? te.equipment,
        ...(merge.loadMode !== undefined ? { loadMode: merge.loadMode } : {}),
        ...touch(te.clientRev),
      })
      await enqueue('templateExercises', te.id)
    }
    // The retired system row can't sync a change, so hide it locally, and drop its
    // now-orphaned caches.
    const stale = exercises.find((e) => e.id === merge.from)
    if (stale && stale.userId === null && !stale.isArchived) {
      await db.exercises.update(merge.from, { isArchived: true })
    }
    await db.personalRecords.where('exerciseId').equals(merge.from).delete()
    await db.lastPerformance.where('exerciseId').equals(merge.from).delete()
  }

  // 3. Coerce retired bodyweight tracking types to the single bodyweight type.
  for (const exercise of exercises) {
    if (!RETIRED_BODYWEIGHT_TRACKING.has(exercise.trackingType)) continue
    await db.exercises.update(exercise.id, {
      trackingType: 'bodyweight_reps',
      bodyweightFactor: exercise.bodyweightFactor ?? 1,
      ...touch(exercise.clientRev),
    })
    // Only user-authored rows sync; system rows are corrected by the seed.
    if (exercise.userId !== null) await enqueue('exercises', exercise.id)
  }

  // 4. Rebuild only the pairs this run actually changed.
  await rebuildCachePairs(touched)

  try {
    localStorage.setItem(EXERCISE_MODEL_MIGRATED_KEY, EXERCISE_MODEL_MIGRATION_VERSION)
  } catch {
    // No localStorage (private mode / headless): fall back to running each launch.
  }
}

// Fills `bodyweightKg` on sessions that snapshotted null — begun before any
// bodyweight was on file — from the bodyweight measurement nearest each session's
// date (the best estimate of what the user weighed then). The bodyweight lifts in
// a corrected session are added to `touched` so their volume/records recompute.
async function backfillWorkoutBodyweight(
  allWorkoutExercises: WorkoutExercise[],
  trackingOf: Map<string, TrackingType>,
  touched: Set<string>,
): Promise<void> {
  const missing = await db.workouts.filter((w) => w.bodyweightKg === null).toArray()
  if (missing.length === 0) return

  const measurements = (
    await db.metricEntries.where('definitionId').equals('bodyweight').toArray()
  )
    .filter((e) => e.deletedAt === null)
    .sort((a, b) => a.measuredAt - b.measuredAt)
  if (measurements.length === 0) return

  const wesByWorkout = new Map<string, WorkoutExercise[]>()
  for (const we of allWorkoutExercises) {
    wesByWorkout.set(we.workoutId, [...(wesByWorkout.get(we.workoutId) ?? []), we])
  }

  for (const workout of missing) {
    const bodyweightKg = nearestMeasurement(measurements, workout.startedAt)
    await db.workouts.update(workout.id, { bodyweightKg, ...touch(workout.clientRev) })
    await enqueue('workouts', workout.id)
    for (const we of wesByWorkout.get(workout.id) ?? []) {
      if (isBodyweightTracking(trackingOf.get(we.exerciseId))) {
        touched.add(`${we.exerciseId}:${we.equipment}`)
      }
    }
  }
}

// The measurement value closest in time to `at`, preferring the most recent one
// at or before it. `entries` is sorted ascending and non-empty.
function nearestMeasurement(
  entries: { measuredAt: number; value: number }[],
  at: number,
): number {
  let best = entries[0]!
  for (const entry of entries) {
    if (Math.abs(entry.measuredAt - at) <= Math.abs(best.measuredAt - at)) best = entry
  }
  return best.value
}
