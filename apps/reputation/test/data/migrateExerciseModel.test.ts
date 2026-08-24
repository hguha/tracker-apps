/**
 * The one-time migration onto the load-mode exercise model: duplicate movements
 * fold into a canonical base, assisted/weighted variants become a load mode of
 * that base, and rows that predate the `loadMode` field get one stamped on.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { db, syncStamp } from '@/db/database'
import { LOCAL_USER_ID, seedIfNeeded, setActiveUserId } from '@/db/seed'
import { loadModeIsChosen, type WorkoutExercise } from '@/domain/types'
import * as repo from '@/data/repository'

beforeEach(async () => {
  setActiveUserId(LOCAL_USER_ID)
  localStorage.clear()
  await db.delete()
  await db.open()
  await seedIfNeeded()
})

// Adds a workout-exercise as an older build stored it: no `loadMode` field at all.
async function addLegacyWorkoutExercise(
  partial: Partial<WorkoutExercise> & Pick<WorkoutExercise, 'workoutId' | 'exerciseId'>,
): Promise<string> {
  const id = crypto.randomUUID()
  const row = {
    id,
    equipment: 'barbell',
    position: 0,
    supersetGroup: null,
    restSeconds: null,
    notes: '',
    ...syncStamp(),
    ...partial,
  }
  // Strip loadMode so the row looks pre-migration.
  delete (row as { loadMode?: unknown }).loadMode
  await db.workoutExercises.add(row as WorkoutExercise)
  return id
}

describe('migrateExerciseModel', () => {
  it('folds an assisted variant into the base as a load mode', async () => {
    // A legacy separate exercise + a history row pointing at it, machine-loaded.
    await db.exercises.put({
      id: 'assisted_dip',
      userId: null,
      name: 'Assisted Dip',
      region: 'chest',
      aliases: [],
      movementPattern: 'push',
      trackingType: 'assisted_bodyweight' as never,
      bodyweightFactor: 0.95,
      isKeyLift: false,
      notes: '',
      defaultRestSeconds: null,
      isArchived: false,
      ...syncStamp(),
    })
    const workoutId = await repo.startWorkout()
    const weId = await addLegacyWorkoutExercise({
      workoutId,
      exerciseId: 'assisted_dip',
      equipment: 'machine',
    })

    await repo.migrateExerciseModel()

    const we = await db.workoutExercises.get(weId)
    expect(we!.exerciseId).toBe('dip')
    expect(we!.equipment).toBe('bodyweight')
    expect(we!.loadMode).toBe('assisted')
    expect((await db.exercises.get('assisted_dip'))!.isArchived).toBe(true)
  })

  it('renames a duplicate movement while preserving its equipment', async () => {
    await db.exercises.put({
      id: 'incline_press',
      userId: null,
      name: 'Incline Press',
      region: 'chest',
      aliases: [],
      movementPattern: 'push',
      trackingType: 'weight_reps',
      bodyweightFactor: null,
      isKeyLift: false,
      notes: '',
      defaultRestSeconds: null,
      isArchived: false,
      ...syncStamp(),
    })
    const workoutId = await repo.startWorkout()
    const weId = await addLegacyWorkoutExercise({
      workoutId,
      exerciseId: 'incline_press',
      equipment: 'machine',
    })

    await repo.migrateExerciseModel()

    const we = await db.workoutExercises.get(weId)
    expect(we!.exerciseId).toBe('incline_bench_press')
    expect(we!.equipment).toBe('machine')
    expect(we!.loadMode).toBeNull()
  })

  it('backfills bodyweight mode on a predating row with no added weight', async () => {
    const workoutId = await repo.startWorkout()
    const weId = await addLegacyWorkoutExercise({
      workoutId,
      exerciseId: 'dip', // seeded as bodyweight_reps
      equipment: 'bodyweight',
    })
    await repo.addSet({ workoutExerciseId: weId, reps: 10, isCompleted: true })

    await repo.migrateExerciseModel()

    expect((await db.workoutExercises.get(weId))!.loadMode).toBe('bodyweight')
  })

  it('infers weighted mode from a logged added weight, not the tracking type', async () => {
    // The real bug: a sync pull can flip the library row to bodyweight_reps before
    // the migration reads it, so the mode must come from the set data — a weight
    // can only be entered in weighted mode.
    const workoutId = await repo.startWorkout()
    const weId = await addLegacyWorkoutExercise({
      workoutId,
      exerciseId: 'dip',
      equipment: 'bodyweight',
    })
    await repo.addSet({ workoutExerciseId: weId, weightKg: 20, reps: 8, isCompleted: true })

    await repo.migrateExerciseModel()

    expect((await db.workoutExercises.get(weId))!.loadMode).toBe('weighted')
  })

  it('self-heals a row an earlier pass wrongly stamped bodyweight', async () => {
    // Weight in bodyweight mode is impossible through the UI, so it can only be a
    // mis-migrated weighted row; the migration must correct it on a later run.
    const workoutId = await repo.startWorkout()
    const weId = crypto.randomUUID()
    await db.workoutExercises.add({
      id: weId,
      workoutId,
      exerciseId: 'dip',
      equipment: 'bodyweight',
      loadMode: 'bodyweight',
      position: 0,
      supersetGroup: null,
      restSeconds: null,
      notes: '',
      ...syncStamp(),
    })
    await repo.addSet({ workoutExerciseId: weId, weightKg: 25, reps: 6, isCompleted: true })

    await repo.migrateExerciseModel()

    expect((await db.workoutExercises.get(weId))!.loadMode).toBe('weighted')
  })

  it('leaves non-bodyweight rows with a null load mode', async () => {
    const workoutId = await repo.startWorkout()
    const weId = await addLegacyWorkoutExercise({
      workoutId,
      exerciseId: 'bench_press',
      equipment: 'barbell',
    })

    await repo.migrateExerciseModel()

    expect((await db.workoutExercises.get(weId))!.loadMode).toBeNull()
  })

  it('coerces a custom exercise off a retired bodyweight tracking type', async () => {
    await db.exercises.put({
      id: 'custom_weighted_situp',
      userId: LOCAL_USER_ID,
      name: 'Weighted Sit-up',
      region: 'core',
      aliases: [],
      movementPattern: 'other',
      trackingType: 'weighted_bodyweight' as never,
      bodyweightFactor: null,
      isKeyLift: false,
      notes: '',
      defaultRestSeconds: null,
      isArchived: false,
      ...syncStamp(),
    })

    await repo.migrateExerciseModel()

    const fixed = await db.exercises.get('custom_weighted_situp')
    expect(fixed!.trackingType).toBe('bodyweight_reps')
    expect(fixed!.bodyweightFactor).toBe(1)
  })

  it('re-stamps a bodyweight system row so the add sheet offers a load mode', async () => {
    // Simulate a device created by the old build: dip is still weighted_bodyweight.
    await db.exercises.update('dip', { trackingType: 'weighted_bodyweight' as never })

    await repo.migrateExerciseModel()

    const dip = await db.exercises.get('dip')
    expect(dip!.trackingType).toBe('bodyweight_reps')
    // This is exactly what the picker checks to show the Bodyweight/Weighted/
    // Assisted sheet, so the option appears when adding dip.
    expect(loadModeIsChosen(dip!.trackingType)).toBe(true)
  })

  it('backfills a session bodyweight from the nearest measurement', async () => {
    // A session logged before any bodyweight was on file, plus two measurements
    // around it — the nearer one wins.
    await repo.updateProfile({ bodyweightCacheKg: null })
    const startedAt = Date.parse('2024-06-15T12:00:00Z')
    await repo.addMetricEntry({
      definitionId: 'bodyweight',
      value: 78,
      measuredAt: Date.parse('2024-06-14T08:00:00Z'),
    })
    await repo.addMetricEntry({
      definitionId: 'bodyweight',
      value: 90,
      measuredAt: Date.parse('2024-01-01T08:00:00Z'),
    })
    const workoutId = await repo.startWorkout({ startedAt })
    // startWorkout snapshots the (now-set) cache, so force the pre-fix null state.
    await db.workouts.update(workoutId, { bodyweightKg: null })

    await repo.migrateExerciseModel()

    expect((await repo.getWorkout(workoutId))!.bodyweightKg).toBe(78)
  })

  it('leaves a session bodyweight null when no measurement exists', async () => {
    await repo.updateProfile({ bodyweightCacheKg: null })
    const workoutId = await repo.startWorkout()
    await db.workouts.update(workoutId, { bodyweightKg: null })

    await repo.migrateExerciseModel()

    expect((await repo.getWorkout(workoutId))!.bodyweightKg).toBeNull()
  })

  it('is idempotent — a second run changes nothing', async () => {
    const workoutId = await repo.startWorkout()
    await addLegacyWorkoutExercise({
      workoutId,
      exerciseId: 'dip',
      equipment: 'bodyweight',
    })
    await repo.migrateExerciseModel()
    const after = await db.workoutExercises.toArray()
    await repo.migrateExerciseModel()
    expect(await db.workoutExercises.toArray()).toEqual(after)
  })
})
