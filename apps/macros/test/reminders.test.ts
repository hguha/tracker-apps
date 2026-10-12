import { beforeEach, describe, expect, it } from 'vitest'
import { dayKey } from '@tracker-engine/core'

const dayAfter = (at: number, days: number) => {
  const date = new Date(at)
  date.setDate(date.getDate() + days)
  return dayKey(date.getTime())
}
import { db } from '@/db'
import * as repo from '@/data/repository'
import { seedFoods } from '@/db/seed'
import { remindersAhead } from '@/data/reminders'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  localStorage.clear()
  await seedFoods()
  repo.setActiveUserId('local-user')
  await repo.setReminders({
    meals: [{ meal: 'lunch', minute: 13 * 60, enabled: true }],
    endOfDay: { minute: 21 * 60, enabled: false },
    weighIn: { minute: 8 * 60, enabled: true },
  })
})

describe('remindersAhead', () => {
  it('schedules the coming days too, so a day the app isn’t opened still gets nudged', async () => {
    const evening = new Date(2026, 9, 12, 22, 0).getTime()
    const due = await remindersAhead(evening)
    const lunchDays = due
      .filter((r) => r.title.startsWith('Lunch'))
      .map((r) => dayKey(r.at))
    expect(lunchDays).toEqual(Array.from({ length: 7 }, (_, i) => dayAfter(evening, i)))
    expect(new Set(due.map((r) => r.id)).size).toBe(due.length)
  })

  it('skips a day that already has what the reminder asks for', async () => {
    const now = new Date(2026, 9, 12, 9, 0).getTime()
    const tomorrow = dayAfter(now, 1)
    const [food] = await repo.searchFoods('chicken breast')
    await repo.logFood({ food: food!, grams: 100, meal: 'lunch', eatenAt: Date.parse(`${tomorrow}T13:00:00`) })
    await repo.recordWeight(80, tomorrow)

    const onTomorrow = (await remindersAhead(now)).filter((r) => dayKey(r.at) === tomorrow)
    expect(onTomorrow).toEqual([])
  })
})
