import { beforeEach, describe, expect, it } from 'vitest'
import { DAY_MS } from '@tracker-engine/core'
import { db } from '@/db/database'
import { LOCAL_USER_ID, seedIfNeeded, setActiveUserId } from '@/db/seed'
import * as repo from '@/data/repository'
import { buildCoachContext } from '@/features/coach/context'

beforeEach(async () => {
  setActiveUserId(LOCAL_USER_ID)
  localStorage.clear()
  await db.delete()
  await db.open()
  await seedIfNeeded()
})

describe('buildCoachContext', () => {
  it('carries the notes and the bodyweight goal in the user’s unit', async () => {
    await repo.updateProfile({ unitWeight: 'kg', coachNotes: 'Bad left shoulder; home gym' })
    for (let day = 0; day < 15; day += 1) {
      await repo.addMetricEntry({
        definitionId: 'bodyweight',
        value: 80 - day * 0.1,
        measuredAt: Date.now() - (14 - day) * DAY_MS,
      })
    }
    await repo.setGoalWeight(75)

    const { profile } = await buildCoachContext()

    expect(profile.coachNotes).toBe('Bad left shoulder; home gym')
    expect(profile.goalWeight).toBe(75)
    expect(profile.bodyweightTrend).toBeGreaterThan(78)
    expect(profile.bodyweightPerWeek).toBeLessThan(0)
  })

  it('leaves the goal out when none is set', async () => {
    const { profile } = await buildCoachContext()
    expect(profile.goalWeight).toBeNull()
    expect(profile.coachNotes).toBe('')
  })
})
