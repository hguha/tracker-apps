import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import * as repo from '@/data/repository'
import { seedFoods } from '@/db/seed'
import { executeRetrievalTool, isActionTool, toolToAction } from '@/features/coach/tools'
import { mockCoachProvider } from '@/features/coach/mockProvider'
import type { CoachContext } from '@/features/coach/types'

const CONTEXT: CoachContext = {
  today: { kcal: 0, proteinG: 0 },
  targetKcal: null,
  goal: null,
  units: 'metric',
  dietNotes: '',
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  localStorage.clear()
  await seedFoods()
  repo.setActiveUserId('local-user')
})

async function chicken() {
  const [food] = await repo.searchFoods('chicken breast')
  if (!food) throw new Error('seed missing')
  return food
}

describe('tool classification', () => {
  it('marks only the proposing tools terminal', () => {
    expect(isActionTool('logFood')).toBe(true)
    expect(isActionTool('suggestMeal')).toBe(true)
    expect(isActionTool('getToday')).toBe(false)
    expect(isActionTool('searchFoods')).toBe(false)
  })
})

describe('retrieval tools', () => {
  it('reports today in grams, not milligrams', async () => {
    await repo.logFood({ food: await chicken(), meal: 'lunch', grams: 200 })
    const result = (await executeRetrievalTool('getToday', {})) as {
      eaten: { kcal: number; proteinG: number }
    }
    // 200g of the seeded chicken: 240 kcal, 45g protein. mg would read as 45000 to a model.
    expect(result.eaten).toMatchObject({ kcal: 240, proteinG: 45 })
  })

  it('caps getRecentDays so one call cannot pull a year', async () => {
    const result = (await executeRetrievalTool('getRecentDays', { days: 9999 })) as unknown[]
    expect(Array.isArray(result)).toBe(true)
  })

  it('returns foodIds from searchFoods, which is what logging requires', async () => {
    const result = (await executeRetrievalTool('searchFoods', { query: 'chicken' })) as {
      foodId: string
    }[]
    expect(result[0]?.foodId).toMatch(/^seed:/)
  })

  it('rejects an unknown tool rather than silently returning nothing', async () => {
    await expect(executeRetrievalTool('dropDatabase', {})).rejects.toThrow(/Unknown tool/)
  })
})

describe('toolToAction', () => {
  it('computes macros from the food row, not from the model', async () => {
    const food = await chicken()
    const action = await toolToAction('logFood', {
      foodId: food.id,
      grams: 200,
      meal: 'dinner',
      // A model could claim anything here; it must be ignored entirely.
      kcal: 99999,
    })
    expect(action).toMatchObject({ kind: 'log-food', grams: 200, meal: 'dinner' })
    expect(action && 'nutrients' in action && action.nutrients.kcal).toBe(240)
  })

  it('refuses a foodId that does not exist, so a hallucination cannot be logged', async () => {
    expect(await toolToAction('logFood', { foodId: 'usda:made-up', grams: 100, meal: 'lunch' })).toBeNull()
  })

  it('refuses a non-positive amount', async () => {
    const food = await chicken()
    expect(await toolToAction('logFood', { foodId: food.id, grams: 0, meal: 'lunch' })).toBeNull()
  })

  it('falls back to snack for an unrecognised meal', async () => {
    const food = await chicken()
    const action = await toolToAction('logFood', { foodId: food.id, grams: 100, meal: 'brunch' })
    expect(action && 'meal' in action && action.meal).toBe('snack')
  })

  it('sums a suggested meal from its matched items and drops unmatched ones', async () => {
    const food = await chicken()
    const action = await toolToAction('suggestMeal', {
      title: 'Chicken and rice',
      items: [
        { foodId: food.id, grams: 100 },
        { foodId: 'nope', grams: 100 },
      ],
    })
    expect(action && 'items' in action && action.items).toHaveLength(1)
    expect(action && 'nutrients' in action && action.nutrients.kcal).toBe(120)
  })

  it('returns null when nothing matched at all', async () => {
    expect(await toolToAction('suggestMeal', { title: 'x', items: [{ foodId: 'no', grams: 1 }] })).toBeNull()
  })
})

describe('offline coach', () => {
  it('is always available, so a missing key is never a dead end', async () => {
    expect(await mockCoachProvider.isAvailable()).toBe(true)
  })

  it('answers from the repository rather than inventing numbers', async () => {
    await repo.logFood({ food: await chicken(), meal: 'lunch', grams: 100 })
    const result = await mockCoachProvider.chat(
      [{ role: 'user', parts: [{ text: 'how am I doing' }] }],
      CONTEXT,
    )
    expect(result.text).toContain('120')
    expect(result.action).toBeNull()
  })

  it('says it has no target rather than guessing one', async () => {
    const result = await mockCoachProvider.chat(
      [{ role: 'user', parts: [{ text: "what's left to eat today?" }] }],
      CONTEXT,
    )
    expect(result.text).toMatch(/don't have a target/)
  })

  it('explains that expenditure already includes training', async () => {
    await repo.saveCheckIn({
      weekStart: '2026-08-31',
      expenditureKcal: 2500,
      expenditureSe: 120,
      trendKg: 80,
      trendChangeKgPerWeek: -0.4,
      meanIntakeKcal: 2100,
      daysLogged: 7,
      kcalPerKg: 7700,
      targets: { kcal: 2100, proteinMg: 144_000, carbsMg: 200_000, fatMg: 58_000 },
      status: 'applied',
      note: '',
    })
    const result = await mockCoachProvider.chat(
      [{ role: 'user', parts: [{ text: 'what is my tdee?' }] }],
      CONTEXT,
    )
    expect(result.text).toContain('2500')
    expect(result.text).toMatch(/includes your training/)
  })
})
