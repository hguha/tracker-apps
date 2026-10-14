import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/database'
import { LOCAL_USER_ID, seedIfNeeded, setActiveUserId } from '@/db/seed'
import * as repo from '@/data/repository'

beforeEach(async () => {
  setActiveUserId(LOCAL_USER_ID)
  localStorage.clear()
  await db.delete()
  await db.open()
  await seedIfNeeded()
})

describe('moveWorkout', () => {
  it('keeps the session length when a finished workout moves to another day', async () => {
    const id = await repo.startWorkout()
    const start = new Date(2026, 9, 5, 18, 0).getTime()
    await repo.updateWorkout(id, { startedAt: start, endedAt: start + 3_600_000 })

    const movedTo = new Date(2026, 9, 3, 7, 30).getTime()
    await repo.moveWorkout(id, movedTo)

    const workout = (await db.workouts.get(id))!
    expect(workout.startedAt).toBe(movedTo)
    expect(workout.endedAt).toBe(movedTo + 3_600_000)
  })

  it('leaves an unfinished workout unfinished', async () => {
    const id = await repo.startWorkout()
    await repo.moveWorkout(id, new Date(2026, 9, 3, 7, 30).getTime())
    expect((await db.workouts.get(id))!.endedAt).toBeNull()
  })
})
