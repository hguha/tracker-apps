import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/database'
import { LOCAL_USER_ID, seedIfNeeded, setActiveUserId } from '@/db/seed'
import * as repo from '@/data/repository'
import {
  BackupParseError,
  buildBackup,
  countsOf,
  exportToJson,
  importBackup,
  parseBackup,
} from './backup'

beforeEach(async () => {
  setActiveUserId(LOCAL_USER_ID)
  await db.delete()
  await db.open()
  await seedIfNeeded()
})

/** Log a small but complete session so the export has a full graph to carry. */
async function seedSession() {
  const workoutId = await repo.startWorkout({ title: 'Push' })
  const bench = await repo.addExerciseToWorkout(workoutId, 'bench_press', 'barbell')
  for (const reps of [8, 6]) {
    const id = await repo.addSet({ workoutExerciseId: bench, weightKg: 100, reps })
    await repo.logSetValues(id, {})
  }
  await repo.finishWorkout(workoutId)
  return workoutId
}

describe('buildBackup', () => {
  it('captures logged workouts, their exercises, and sets', async () => {
    await seedSession()
    const backup = await buildBackup()
    expect(backup.format).toBe('fitnote-backup')
    expect(backup.data.workouts).toHaveLength(1)
    expect(backup.data.workoutExercises).toHaveLength(1)
    expect(backup.data.sets).toHaveLength(2)
  })

  it('excludes the system exercise library, keeping only custom exercises', async () => {
    const customId = await repo.createExercise({
      name: 'My Custom Curl',
      region: 'biceps',
      trackingType: 'weight_reps',
    })
    const backup = await buildBackup()
    expect(backup.data.exercises).toHaveLength(1)
    expect(backup.data.exercises[0]!.id).toBe(customId)
  })

  it('omits soft-deleted rows', async () => {
    const workoutId = await seedSession()
    await repo.deleteWorkout(workoutId)
    const backup = await buildBackup()
    expect(backup.data.workouts).toHaveLength(0)
  })
})

describe('export → import round-trip', () => {
  it('restores an identical graph after a wipe', async () => {
    await seedSession()
    const json = await exportToJson()

    await repo.clearLocalData()
    expect((await buildBackup()).data.workouts).toHaveLength(0)

    const counts = await importBackup(parseBackup(json))
    expect(counts.workouts).toBe(1)

    const restored = await buildBackup()
    expect(restored.data.workouts).toHaveLength(1)
    expect(restored.data.sets).toHaveLength(2)
    // The set graph is intact: sets still point at a restored workout-exercise.
    const weId = restored.data.workoutExercises[0]!.id
    expect(restored.data.sets.every((s) => s.workoutExerciseId === weId)).toBe(true)
  })

  it('is idempotent — importing the same file twice does not duplicate', async () => {
    await seedSession()
    const backup = parseBackup(await exportToJson())
    await repo.clearLocalData()

    await importBackup(backup)
    await importBackup(backup)

    const restored = await buildBackup()
    expect(restored.data.workouts).toHaveLength(1)
    expect(restored.data.sets).toHaveLength(2)
  })

  it('re-owns imported rows to the active user', async () => {
    await seedSession()
    const backup = parseBackup(await exportToJson())

    // Import while a different user is active — rows must adopt that id.
    setActiveUserId('someone-else')
    await seedIfNeeded()
    await importBackup(backup)

    const workouts = await db.workouts.toArray()
    expect(workouts).toHaveLength(1)
    expect(workouts[0]!.userId).toBe('someone-else')
  })
})

describe('parseBackup validation', () => {
  it('rejects non-JSON', () => {
    expect(() => parseBackup('{not json')).toThrow(BackupParseError)
  })

  it('rejects a file that is not a FitNote backup', () => {
    expect(() => parseBackup(JSON.stringify({ hello: 'world' }))).toThrow(
      BackupParseError,
    )
  })

  it('refuses a backup from a newer app version', () => {
    const future = JSON.stringify({
      format: 'fitnote-backup',
      version: 999,
      exportedAt: 0,
      data: {},
    })
    expect(() => parseBackup(future)).toThrow(/newer version/)
  })

  it('tolerates a missing table by defaulting it to empty', () => {
    const partial = JSON.stringify({
      format: 'fitnote-backup',
      version: 1,
      exportedAt: 0,
      data: { workouts: [{ id: 'w1' }] },
    })
    const parsed = parseBackup(partial)
    expect(parsed.data.workouts).toHaveLength(1)
    expect(parsed.data.templates).toEqual([])
    expect(countsOf(parsed).sets).toBe(0)
  })
})
