import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/database'
import { LOCAL_USER_ID, seedIfNeeded, setActiveUserId } from '@/db/seed'
import * as repo from '@/data/repository'
import { buildCoachContext } from '@/features/coach/context'
import { executeRetrievalTool } from '@/features/coach/tools'

const originalTz = process.env.TZ

beforeAll(() => {
  process.env.TZ = 'America/Los_Angeles'
})

afterAll(() => {
  process.env.TZ = originalTz
})

beforeEach(async () => {
  setActiveUserId(LOCAL_USER_ID)
  localStorage.clear()
  await db.delete()
  await db.open()
  await seedIfNeeded()
})

async function logEveningSession(): Promise<void> {
  const workoutId = await repo.startWorkout()
  const weId = await repo.addExerciseToWorkout(workoutId, 'bench_press', 'barbell')
  await repo.addSet({ workoutExerciseId: weId, weightKg: 100, reps: 5, isCompleted: true })
  await repo.finishWorkout(workoutId)
  await repo.updateWorkout(workoutId, { startedAt: new Date(2026, 9, 5, 21, 30).getTime() })
}

describe('coach dates', () => {
  it('dates an evening workout by the local day it happened, not the UTC day', async () => {
    expect(new Date(2026, 9, 5, 21, 30).getTimezoneOffset()).toBeGreaterThan(0)
    await logEveningSession()

    const context = await buildCoachContext()
    expect(context.recentWorkouts[0]?.date).toBe('2026-10-05')

    const history = (await executeRetrievalTool('getExerciseHistory', {
      exercise: 'Bench Press',
    })) as { sessions: { date: string }[] }
    expect(history.sessions[0]?.date).toBe('2026-10-05')
  })
})
