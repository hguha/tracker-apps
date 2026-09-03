/**
 * Bodyweight volume needs the session's bodyweight. A session that began before a
 * bodyweight was on file snapshots null; adding a bodyweight lift should adopt the
 * profile's bodyweight so the lift scores volume instead of reading as zero.
 */

import { beforeEach, expect, it } from 'vitest'
import { db } from '@/db/database'
import { LOCAL_USER_ID, seedIfNeeded, setActiveUserId } from '@/db/seed'
import * as repo from '@/data/repository'

beforeEach(async () => {
  setActiveUserId(LOCAL_USER_ID)
  localStorage.clear()
  await db.delete()
  await db.open()
  await seedIfNeeded()
  // No bodyweight on file, as if the user skipped it at onboarding.
  await repo.updateProfile({ bodyweightCacheKg: null })
})

it('adopts the profile bodyweight when a bodyweight lift is added mid-session', async () => {
  const workoutId = await repo.startWorkout()
  expect((await repo.getWorkout(workoutId))!.bodyweightKg).toBeNull()

  // The picker captures a bodyweight before adding, when one was missing.
  await repo.addMetricEntry({ definitionId: 'bodyweight', value: 80 })
  const weId = await repo.addExerciseToWorkout(workoutId, 'dip', 'bodyweight', 'bodyweight')

  // The session adopted it, so the lift scores volume rather than zero.
  expect((await repo.getWorkout(workoutId))!.bodyweightKg).toBe(80)
  await repo.addSet({ workoutExerciseId: weId, reps: 10, isCompleted: true })
  const detail = await repo.getExerciseDetail('dip')
  const session = detail!.sessions.find((s) => s.workoutId === workoutId)!
  expect(session.volumeKg).toBeGreaterThan(0)
})

it('leaves the snapshot null when no bodyweight is known at all', async () => {
  const workoutId = await repo.startWorkout()
  await repo.addExerciseToWorkout(workoutId, 'dip', 'bodyweight', 'bodyweight')
  expect((await repo.getWorkout(workoutId))!.bodyweightKg).toBeNull()
})

it('backfills a FINISHED session that had no bodyweight, so its volume stops reading zero', async () => {
  // A back day logged before any bodyweight existed: pull-ups score nothing.
  const workoutId = await repo.startWorkout()
  const weId = await repo.addExerciseToWorkout(workoutId, 'pull_up', 'bodyweight', 'bodyweight')
  await repo.addSet({ workoutExerciseId: weId, reps: 10, isCompleted: true })
  await repo.finishWorkout(workoutId)

  const before = await repo.getExerciseDetail('pull_up')
  expect(before!.sessions.find((s) => s.workoutId === workoutId)!.volumeKg).toBe(0)

  // Recording a bodyweight now repairs the finished session too.
  await repo.addMetricEntry({ definitionId: 'bodyweight', value: 80 })

  expect((await repo.getWorkout(workoutId))!.bodyweightKg).toBe(80)
  const after = await repo.getExerciseDetail('pull_up')
  expect(after!.sessions.find((s) => s.workoutId === workoutId)!.volumeKg).toBe(800)
})

it('backfill is idempotent and never overwrites a bodyweight already on a session', async () => {
  await repo.addMetricEntry({ definitionId: 'bodyweight', value: 80 })
  const workoutId = await repo.startWorkout()
  // A finished workout needs logged work, or it's discarded as empty.
  const weId = await repo.addExerciseToWorkout(workoutId, 'pull_up', 'bodyweight', 'bodyweight')
  await repo.addSet({ workoutExerciseId: weId, reps: 8, isCompleted: true })
  await repo.finishWorkout(workoutId)

  // A later, heavier measurement must not rewrite the session's snapshot.
  await repo.addMetricEntry({ definitionId: 'bodyweight', value: 95 })
  expect((await repo.getWorkout(workoutId))!.bodyweightKg).toBe(80)
  expect(await repo.backfillWorkoutBodyweights()).toBe(0)
})

it('dates a measurement to an old session so it is scored with the right weight', async () => {
  const DAY = 86_400_000
  const old = await repo.startWorkout()
  const weId = await repo.addExerciseToWorkout(old, 'pull_up', 'bodyweight', 'bodyweight')
  await repo.addSet({ workoutExerciseId: weId, reps: 5, isCompleted: true })
  await repo.finishWorkout(old)
  // Pretend that session happened a year ago.
  await repo.updateWorkout(old, { startedAt: Date.now() - 365 * DAY })

  // Two measurements: one near that session, one recent. The nearest wins.
  await repo.addMetricEntry({
    definitionId: 'bodyweight',
    value: 70,
    measuredAt: Date.now() - 360 * DAY,
  })
  expect((await repo.getWorkout(old))!.bodyweightKg).toBe(70)
})
