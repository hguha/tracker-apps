import { describe, expect, it } from 'vitest'
import { dishGroups, mealGroups } from '@/lib/dayGroups'
import { EMPTY_NUTRIENTS, type LogEntry, type MealSlot } from '@/domain/types'

function entry(options: {
  id: string
  meal: MealSlot
  hour: number
  kcal: number
  dishId?: string | null
  dishName?: string | null
}): LogEntry {
  const eatenAt = Date.parse(`2026-09-10T${String(options.hour).padStart(2, '0')}:00:00`)
  return {
    id: options.id,
    userId: 'u',
    day: '2026-09-10',
    eatenAt,
    meal: options.meal,
    sortIndex: eatenAt,
    foodId: 'usda:1',
    recipeId: null,
    quickAdd: null,
    fromRecipeId: null,
    dishId: options.dishId ?? null,
    dishName: options.dishName ?? null,
    grams: 100,
    portionId: null,
    portionCount: null,
    nutrients: { ...EMPTY_NUTRIENTS, kcal: options.kcal },
    source: 'search',
    estimate: null,
    venue: null,
    note: '',
    createdAt: eatenAt,
    updatedAt: eatenAt,
    deletedAt: null,
    clientRev: 1,
  }
}

describe('mealGroups', () => {
  it('gives one card per meal, however spread out the logging was', () => {
    // The bug this replaces: grouping on a 45-minute clock gap turned an afternoon of four lunch
    // entries into four cards, every one of them headed "Lunch".
    const groups = mealGroups([
      entry({ id: 'a', meal: 'lunch', hour: 12, kcal: 200 }),
      entry({ id: 'b', meal: 'lunch', hour: 14, kcal: 300 }),
      entry({ id: 'c', meal: 'lunch', hour: 16, kcal: 100 }),
      entry({ id: 'd', meal: 'lunch', hour: 17, kcal: 100 }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.meal).toBe('lunch')
    expect(groups[0]!.nutrients.kcal).toBe(700)
  })

  it('keeps a snack out of the lunch it happened to follow', () => {
    // Twenty minutes after lunch is inside the old gap threshold, so the snack used to disappear
    // into lunch — and the user had told the app which was which.
    const groups = mealGroups([
      entry({ id: 'a', meal: 'lunch', hour: 12, kcal: 600 }),
      entry({ id: 'b', meal: 'snack', hour: 13, kcal: 150 }),
    ])
    expect(groups.map((group) => group.meal)).toEqual(['lunch', 'snack'])
  })

  it('orders by the meal, not by the clock', () => {
    // Someone logging dinner before remembering breakfast still gets breakfast first.
    const groups = mealGroups([
      entry({ id: 'a', meal: 'dinner', hour: 20, kcal: 700 }),
      entry({ id: 'b', meal: 'breakfast', hour: 21, kcal: 400 }),
    ])
    expect(groups.map((group) => group.meal)).toEqual(['breakfast', 'dinner'])
  })

  it('has no rows for a meal with nothing in it', () => {
    const groups = mealGroups([entry({ id: 'a', meal: 'dinner', hour: 20, kcal: 700 })])
    expect(groups).toHaveLength(1)
  })
})

describe('dishGroups', () => {
  it('collapses a dish to one group and leaves loose foods alone', () => {
    const groups = dishGroups([
      entry({ id: 'a', meal: 'lunch', hour: 12, kcal: 200, dishId: 'd1', dishName: '3 steak tacos' }),
      entry({ id: 'b', meal: 'lunch', hour: 12, kcal: 150, dishId: 'd1', dishName: '3 steak tacos' }),
      entry({ id: 'c', meal: 'lunch', hour: 12, kcal: 90 }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ dishId: 'd1', name: '3 steak tacos' })
    expect(groups[0]!.nutrients.kcal).toBe(350)
    expect(groups[1]!.dishId).toBeNull()
  })

  it('never pools two separate foods into an invented dish', () => {
    const groups = dishGroups([
      entry({ id: 'a', meal: 'lunch', hour: 12, kcal: 200 }),
      entry({ id: 'b', meal: 'lunch', hour: 12, kcal: 150 }),
    ])
    expect(groups).toHaveLength(2)
  })

  it('keeps the order things were logged in, dish or not', () => {
    const groups = dishGroups([
      entry({ id: 'a', meal: 'lunch', hour: 12, kcal: 90 }),
      entry({ id: 'b', meal: 'lunch', hour: 13, kcal: 200, dishId: 'd1', dishName: 'Soup' }),
      entry({ id: 'c', meal: 'lunch', hour: 14, kcal: 50 }),
      entry({ id: 'd', meal: 'lunch', hour: 15, kcal: 100, dishId: 'd1', dishName: 'Soup' }),
    ])
    // The dish takes the position of its first row rather than being hoisted or appended.
    expect(groups.map((group) => group.dishId)).toEqual([null, 'd1', null])
    expect(groups[1]!.entries).toHaveLength(2)
  })
})

describe('a sitting that spans the day', () => {
  it('reports both ends, so a 2pm and a 10pm snack are not both called 2pm', () => {
    // Grouping is by meal slot, which is right — but a slot is not a moment, and heading the card
    // with the first row's time stated one snack's time as though it were both.
    const early = entry({ id: 'a', meal: 'snack', hour: 14, kcal: 100 })
    const late = entry({ id: 'b', meal: 'snack', hour: 22, kcal: 200 })
    // Given out of order on purpose: the group's ends are facts about the clock, not about the
    // order the rows happened to arrive in.
    const [group] = mealGroups([late, early])
    expect(group!.firstAt).toBe(early.eatenAt)
    expect(group!.lastAt).toBe(late.eatenAt)
    expect(Number.isFinite(group!.firstAt)).toBe(true)
  })

  it('has firstAt equal to lastAt for a single row', () => {
    const only = entry({ id: 'a', meal: 'lunch', hour: 12, kcal: 50 })
    const [group] = mealGroups([only])
    expect(group!.firstAt).toBe(group!.lastAt)
  })
})
