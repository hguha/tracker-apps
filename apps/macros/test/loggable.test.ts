import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { dayKey } from '@tracker-engine/core'
import { db } from '@/db'
import * as repo from '@/data/repository'
import { seedFoods } from '@/db/seed'
import { describeLoggable, partsOf, GRAMS } from '@/features/log/loggable'
import { nutrientsFor } from '@/lib/nutrition'
import { givenFoods, testFood } from './fixtures'
import { EMPTY_NUTRIENTS } from '@/domain/types'

/**
 * The five things that can be added to a day, through the one screen that adds them.
 *
 * They used to be three separate controls with three separate arithmetics, which is exactly the sort
 * of divergence that produces two different answers to "what did that cost me". These assert that the
 * amount on screen and the rows written agree, for every kind.
 */
beforeAll(async () => {
  await seedFoods()
})

beforeEach(async () => {
  await Promise.all(db.tables.filter((table) => table.name !== 'foods').map((t) => t.clear()))
  repo.setActiveUserId('local-user')
  await givenFoods()
})

const today = () => dayKey(Date.now())

describe('a food', () => {
  it('offers its own portions and grams, and opens on the default portion', () => {
    const subject = describeLoggable({ kind: 'food', food: testFood() })
    expect(subject.units.map((unit) => unit.id)).toEqual(['p0', GRAMS])
    expect(subject.initialUnitId).toBe('p0')
    expect(subject.isComposite).toBe(false)
  })

  it('asks the same function the write will ask, so the preview cannot drift', () => {
    const food = testFood()
    const subject = describeLoggable({ kind: 'food', food })
    const portion = subject.units[0]!
    expect(portion.nutrientsAt(2)).toEqual(nutrientsFor(food, 174 * 2))
    expect(portion.gramsAt(2)).toBe(348)
  })

  it('falls back to grams when the food has no stated portion', () => {
    const subject = describeLoggable({
      kind: 'food',
      food: testFood({ id: 'usda:no-portions', portions: [] }),
    })
    expect(subject.initialUnitId).toBe(GRAMS)
  })

  it('writes one row at the amount shown', async () => {
    const food = testFood()
    const subject = describeLoggable({ kind: 'food', food })
    const written = await subject.log(subject.units[0]!, 2, {
      meal: 'lunch',
      at: Date.now(),
      venue: 'home',
    })
    expect(written).toBe(1)
    const [row] = await repo.entriesForDay(today())
    expect(row!.grams).toBe(348)
    expect(row!.nutrients.kcal).toBe(subject.units[0]!.nutrientsAt(2).kcal)
    expect(row!.venue).toBe('home')
  })
})

describe('a recipe', () => {
  it('counts servings, and the preview matches what gets logged', async () => {
    const food = await repo.getFood('usda:test-chicken')
    const id = await repo.saveRecipe({
      name: 'Chicken tray',
      servings: 4,
      ingredients: [{ foodId: food!.id, label: food!.description, grams: 800 }],
    })
    const recipe = (await repo.recipes()).find((row) => row.id === id)!
    const subject = describeLoggable({ kind: 'recipe', recipe })
    const unit = subject.units[0]!

    expect(unit.label).toBe('serving')
    expect(unit.gramsAt(1)).toBeNull()
    expect(subject.isComposite).toBe(true)

    await subject.log(unit, 2, { meal: 'dinner', at: Date.now(), venue: 'home' })
    const rows = await repo.entriesForDay(today())
    const logged = rows.reduce((total, row) => total + row.nutrients.kcal, 0)
    // Two of four servings, within a kcal of rounding.
    expect(Math.abs(logged - unit.nutrientsAt(2).kcal)).toBeLessThanOrEqual(1)
  })

  it('lists its ingredients per serving, so the empty half of the screen says something', async () => {
    const food = await repo.getFood('usda:test-chicken')
    const id = await repo.saveRecipe({
      name: 'Chicken tray',
      servings: 4,
      ingredients: [
        { foodId: food!.id, label: food!.description, grams: 800 },
        // No food matched: kept in the recipe, contributing nothing, and visible as a zero.
        { foodId: null, label: 'red pepper flakes', grams: 2 },
      ],
    })
    const recipe = (await repo.recipes()).find((row) => row.id === id)!
    const parts = await partsOf({ kind: 'recipe', recipe })

    expect(parts).toHaveLength(2)
    expect(parts[0]!.grams).toBe(200)
    expect(parts[1]!.label).toBe('red pepper flakes')
    expect(parts[1]!.nutrients.kcal).toBe(0)
  })
})

describe('a saved meal', () => {
  it('scales by whole and half portions', async () => {
    const food = testFood()
    await repo.logFood({ food, grams: 200, meal: 'dinner' })
    const entries = await repo.entriesForDay(today())
    const id = await repo.saveMealTemplate('Usual dinner', entries)
    const template = (await repo.mealTemplates()).find((row) => row.id === id)!

    const subject = describeLoggable({ kind: 'meal', template })
    const unit = subject.units[0]!
    expect(unit.nutrientsAt(2).kcal).toBe(template.nutrients.kcal * 2)
    expect(unit.gramsAt(1)).toBe(200)
  })
})

describe('a repeated dish', () => {
  it('counts whole copies only — half of "3 steak tacos" means nothing', async () => {
    const food = testFood()
    const dishId = repo.newDishId()
    await repo.logFood({ food, grams: 100, meal: 'lunch', dishId, dishName: '3 steak tacos' })
    await repo.logFood({ food, grams: 50, meal: 'lunch', dishId, dishName: '3 steak tacos' })

    const recents = await repo.recentItems()
    const dish = recents.find((item) => item.kind === 'dish')!
    if (dish.kind !== 'dish') throw new Error('expected a dish')

    const subject = describeLoggable({ kind: 'dish', dish })
    expect(subject.units[0]!.step).toBe(1)
    expect(subject.units[0]!.min).toBe(1)

    const parts = await partsOf({ kind: 'dish', dish })
    expect(parts.map((part) => part.grams)).toEqual([100, 50])
  })

  it('writes a copy per multiple', async () => {
    const food = testFood()
    const dishId = repo.newDishId()
    await repo.logFood({ food, grams: 100, meal: 'lunch', dishId, dishName: 'Tacos' })

    const recents = await repo.recentItems()
    const dish = recents.find((item) => item.kind === 'dish')!
    if (dish.kind !== 'dish') throw new Error('expected a dish')

    const subject = describeLoggable({ kind: 'dish', dish })
    const written = await subject.log(subject.units[0]!, 2, {
      meal: 'dinner',
      at: Date.now(),
      venue: 'home',
    })
    expect(written).toBeGreaterThan(0)
    const dinner = (await repo.entriesForDay(today())).filter((row) => row.meal === 'dinner')
    expect(dinner.reduce((total, row) => total + row.grams, 0)).toBe(200)
  })
})

describe('a calories-only entry', () => {
  it('scales what was logged, through the same screen as everything else', async () => {
    await repo.logQuickAdd(
      { ...EMPTY_NUTRIENTS, kcal: 620, proteinMg: 30_000 },
      'lunch',
      'Cafeteria stir fry',
    )
    const quick = (await repo.recentItems()).find((item) => item.kind === 'quick')!
    if (quick.kind !== 'quick') throw new Error('expected a quick add')

    const subject = describeLoggable({ kind: 'quick', quick })
    const unit = subject.units[0]!
    expect(unit.nutrientsAt(0.5).kcal).toBe(310)
    expect(unit.gramsAt(1)).toBeNull()
    expect(await partsOf({ kind: 'quick', quick })).toEqual([])

    await subject.log(unit, 2, { meal: 'dinner', at: Date.now(), venue: 'home' })
    const dinner = (await repo.entriesForDay(today())).filter((row) => row.meal === 'dinner')
    expect(dinner).toHaveLength(1)
    expect(dinner[0]!.nutrients.kcal).toBe(1240)
    expect(dinner[0]!.note).toBe('Cafeteria stir fry')
  })
})
