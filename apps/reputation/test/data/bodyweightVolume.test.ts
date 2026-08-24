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
