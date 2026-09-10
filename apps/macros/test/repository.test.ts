import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import * as repo from '@/data/repository'
import { seedFoods } from '@/db/seed'
import { givenFoods, testFood } from './fixtures'
import { dayKey } from '@tracker-engine/core'
import { dayTotals, nutrientsFor } from '@/lib/nutrition'
import { lastCompleteWeekKey } from '@/lib/checkin'
import { multipliersForHighDays } from '@/lib/cycling'
import { EMPTY_NUTRIENTS } from '@/domain/types'

// Once per file. `foods` is reference data nobody owns, so re-seeding 1,400 rows between tests is
// pure cost — and with a generated seed that cost grew enough to time them out.
beforeAll(async () => {
  await seedFoods()
})

async function reset() {
  await Promise.all(db.tables.filter((table) => table.name !== 'foods').map((t) => t.clear()))
  localStorage.clear()
  repo.setActiveUserId('local-user')
  // A food this file controls. The seed is generated, so asserting on its top hit for "chicken
  // breast" made these tests fail whenever USDA gained a row — which is not a regression.
  await givenFoods()
}

beforeEach(reset)

const chicken = async () => testFood()

describe('seedFoods', () => {
  it('gives the staples their micronutrients', async () => {
    // These 46 rows are short, clean descriptions, so `rankFoods` puts them above the fuller USDA rows
    // for the queries people type most — which made the app's most-logged foods its least complete, and
    // a day built from them reported six of seven nutrients as unrecorded. See
    // scripts/fill-staple-micros.mjs.
    const chicken = await repo.getFood('seed:0')
    expect(chicken?.description).toBe('Chicken breast, skinless, raw')
    for (const key of ['sodiumMg', 'potassiumMg', 'calciumMg', 'satFatMg'] as const) {
      expect(chicken?.per100[key], `${key} is missing`).not.toBeNull()
    }
    // And the hand-checked macros are untouched: the backfill only ever fills a null.
    expect(chicken?.per100.kcal).toBe(120)
    expect(chicken?.per100.proteinMg).toBe(22_500)
  })

  it('is idempotent, so editing the seed corrects existing installs', async () => {
    const before = await db.foods.count()
    await seedFoods()
    expect(await db.foods.count()).toBe(before)
  })
})

describe('searchFoods', () => {
  it('needs two characters, so an empty box isn’t a full scan', async () => {
    expect(await repo.searchFoods('c')).toEqual([])
  })

  it('matches every term, in any order', async () => {
    const results = await repo.searchFoods('breast chicken')
    expect(results[0]?.description).toContain('Chicken breast')
  })

  it('ranks a whole food above a branded one', async () => {
    await repo.putFoods([
      {
        ...(await chicken()),
        id: 'brand:1',
        description: 'Chicken breast microwave dinner tray',
        brand: 'Some Brand',
      },
    ])
    const results = await repo.searchFoods('chicken breast')
    expect(results[0]?.brand).toBeNull()
  })
})

describe('logFood', () => {
  it('stores resolved nutrients, so reference data can’t rewrite history', async () => {
    const food = await chicken()
    const id = await repo.logFood({ food, meal: 'lunch', grams: 200 })

    // Correcting the food afterwards must not change what was already eaten.
    await repo.putFoods([{ ...food, per100: { ...food.per100, kcal: 999 } }])
    const entry = await db.logEntries.get(id)
    expect(entry?.nutrients.kcal).toBe(240)
  })

  it('defaults to the food’s default portion', async () => {
    const food = await chicken()
    const id = await repo.logFood({ food, meal: 'dinner' })
    const entry = await db.logEntries.get(id)
    expect(entry?.grams).toBe(174)
    expect(entry?.portionId).toBe(food.portions[0]?.id)
  })

  it('queues the write for sync', async () => {
    await repo.logFood({ food: await chicken(), meal: 'lunch', grams: 100 })
    expect(await db.outbox.count()).toBe(1)
  })
})

describe('updateEntryAmount', () => {
  it('re-resolves nutrients so the row stays self-consistent', async () => {
    const id = await repo.logFood({ food: await chicken(), meal: 'lunch', grams: 100 })
    await repo.updateEntryAmount(id, 300)
    const entry = await db.logEntries.get(id)
    expect(entry?.grams).toBe(300)
    expect(entry?.nutrients.kcal).toBe(360)
  })
})

describe('deleteEntry', () => {
  it('tombstones rather than removing, so the delete can sync', async () => {
    const id = await repo.logFood({ food: await chicken(), meal: 'lunch', grams: 100 })
    await repo.deleteEntry(id)
    expect((await db.logEntries.get(id))?.deletedAt).not.toBeNull()
    expect(await repo.entriesForDay((await db.logEntries.get(id))!.day)).toEqual([])
  })
})

describe('recordWeight', () => {
  it('keeps one weigh-in per day, so the trend can’t be skewed by weighing twice', async () => {
    await repo.recordWeight(80, '2026-09-01')
    await repo.recordWeight(81, '2026-09-01')
    const rows = await repo.weights()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kg).toBe(81)
  })
})

describe('copyDay', () => {
  it('re-logs a day into another and queues each copy', async () => {
    const food = await chicken()
    await repo.logFood({ food, meal: 'lunch', grams: 100, day: '2026-09-01' })
    await repo.logFood({ food, meal: 'dinner', grams: 150, day: '2026-09-01' })

    const copied = await repo.copyDay('2026-09-01', '2026-09-02')
    expect(copied).toBe(2)
    const target = await repo.entriesForDay('2026-09-02')
    expect(dayTotals(target).kcal).toBe(dayTotals(await repo.entriesForDay('2026-09-01')).kcal)
  })
})

describe('programs', () => {
  it('ends the previous program when a new one starts', async () => {
    await repo.startProgram({ goal: 'lose', ratePctPerWeek: -0.5, proteinGPerKg: 1.8, fatMinPctKcal: 25 })
    await repo.startProgram({ goal: 'gain', ratePctPerWeek: 0.25, proteinGPerKg: 2, fatMinPctKcal: 25 })

    const active = await repo.activeProgram()
    expect(active?.goal).toBe('gain')
    const all = await db.programs.toArray()
    expect(all.filter((p) => p.endedAt === null)).toHaveLength(1)
  })
})

describe('currentTargets', () => {
  it('is null until a check-in has been applied', async () => {
    expect(await repo.currentTargets()).toBeNull()
  })

  it('reads the newest applied check-in, ignoring proposals', async () => {
    const base = {
      expenditureKcal: 2500, expenditureSe: 120, trendKg: 80,
      trendChangeKgPerWeek: -0.4, meanIntakeKcal: 2100, daysLogged: 7,
      kcalPerKg: 7700, note: '',
    }
    await repo.saveCheckIn({
      ...base, weekStart: '2026-08-24', status: 'applied',
      targets: { kcal: 2000, proteinMg: 1, carbsMg: 1, fatMg: 1 },
    })
    await repo.saveCheckIn({
      ...base, weekStart: '2026-08-31', status: 'proposed',
      targets: { kcal: 9999, proteinMg: 1, carbsMg: 1, fatMg: 1 },
    })
    expect((await repo.currentTargets())?.kcal).toBe(2000)
  })
})

describe('claimLocalData', () => {
  it('re-owns device-only rows and re-queues them', async () => {
    await repo.logFood({ food: await chicken(), meal: 'lunch', grams: 100 })
    await db.outbox.clear()

    const claimed = await repo.claimLocalData('real-user')
    expect(claimed).toBe(1)
    expect((await db.logEntries.toArray())[0]?.userId).toBe('real-user')
    expect(await db.outbox.count()).toBe(1)
  })

  it('must run before the owner guard, which would otherwise wipe what it claimed', async () => {
    await repo.logFood({ food: await chicken(), meal: 'lunch', grams: 100 })

    await repo.claimLocalData('real-user')
    repo.setDbOwner('real-user')
    const wiped = await repo.assertDbOwner('real-user')

    expect(wiped).toBe(false)
    expect(await db.logEntries.count()).toBe(1)
  })

  it('wipes a different real account’s rows', async () => {
    repo.setDbOwner('someone-else')
    await repo.logFood({ food: await chicken(), meal: 'lunch', grams: 100 })

    expect(await repo.assertDbOwner('real-user')).toBe(true)
    expect(await db.logEntries.count()).toBe(0)
  })
})

describe('quick add', () => {
  it('logs macros with no food row behind them', async () => {
    const id = await repo.logQuickAdd({ ...EMPTY_NUTRIENTS, kcal: 400, proteinMg: 20_000 }, 'snack')
    const entry = await db.logEntries.get(id)
    expect(entry?.foodId).toBeNull()
    expect(entry?.nutrients.kcal).toBe(400)
    expect(entry?.source).toBe('quick')
  })
})

describe('weigh-in ids', () => {
  it('derives the id from (user, day), which is the table’s natural key', async () => {
    await repo.recordWeight(80, '2026-09-01')
    const [row] = await repo.weights()
    // A random id would let a device that hadn't pulled yet insert a second row for the same
    // day, and the push would 409 against the unique index and dead-letter silently.
    expect(row!.id).toBe(repo.weightIdFor('local-user', '2026-09-01'))
  })

  it('is idempotent across repeats', async () => {
    await repo.recordWeight(80, '2026-09-01')
    await repo.recordWeight(81, '2026-09-01')
    await repo.recordWeight(82, '2026-09-01')
    const rows = await repo.weights()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.kg).toBe(82)
  })

  it('tombstones a legacy random-id row rather than double-counting the day', async () => {
    await db.bodyWeights.put({
      id: 'legacy-random',
      userId: 'local-user',
      day: '2026-09-02',
      kg: 79,
      source: 'macros',
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
      clientRev: 1,
    })
    await repo.recordWeight(80.5, '2026-09-02')

    const alive = await repo.weights()
    expect(alive).toHaveLength(1)
    expect(alive[0]!.kg).toBe(80.5)
    expect((await db.bodyWeights.get('legacy-random'))?.deletedAt).not.toBeNull()
  })
})

describe('check-in ids', () => {
  const base = {
    expenditureKcal: 2500, expenditureSe: 120, trendKg: 80,
    trendChangeKgPerWeek: -0.4, meanIntakeKcal: 2100, daysLogged: 7,
    kcalPerKg: 7700, note: '', status: 'applied' as const,
    targets: { kcal: 2100, proteinMg: 1, carbsMg: 1, fatMg: 1 },
  }

  it('derives the id from (user, week), matching the unique index', async () => {
    const id = await repo.saveCheckIn({ ...base, weekStart: '2026-08-31' })
    expect(id).toBe(repo.checkInIdFor('local-user', '2026-08-31'))
  })

  it('re-saving a week updates it rather than adding a second row', async () => {
    await repo.saveCheckIn({ ...base, weekStart: '2026-08-31' })
    await repo.saveCheckIn({ ...base, weekStart: '2026-08-31', daysLogged: 5 })
    const all = await repo.checkIns()
    expect(all).toHaveLength(1)
    expect(all[0]!.daysLogged).toBe(5)
  })
})

describe('targets in force', () => {
  const checkIn = (weekStart: string, kcal: number) => ({
    weekStart,
    expenditureKcal: 2500,
    expenditureSe: 120,
    trendKg: 80,
    trendChangeKgPerWeek: -0.4,
    meanIntakeKcal: 2100,
    daysLogged: 7,
    kcalPerKg: 7700,
    note: '',
    status: 'applied' as const,
    targets: { kcal, proteinMg: 1, carbsMg: 1, fatMg: 1 },
  })

  it('scores a day against the check-in that preceded it, not the newest one', async () => {
    // Weeks start Monday. The check-in for the week of 2026-08-24 is drawn once that week ends,
    // so it governs the week of 08-31 — and must not be applied retroactively to 08-26.
    await repo.saveCheckIn(checkIn('2026-08-17', 1800))
    await repo.saveCheckIn(checkIn('2026-08-24', 1600))

    const targets = await repo.targetsByDay(['2026-08-26', '2026-09-02'])
    expect(targets.get('2026-08-26')?.kcal).toBe(1800)
    expect(targets.get('2026-09-02')?.kcal).toBe(1600)
  })

  it('has no target for a day before the first check-in and before any weight', async () => {
    await repo.saveCheckIn(checkIn('2026-08-24', 1600))
    expect((await repo.targetsByDay(['2026-08-01'])).get('2026-08-01')).toBeNull()
  })

  it('reads today from the check-in for the week that just ended', async () => {
    await repo.saveCheckIn(checkIn('2026-01-05', 1800))
    await repo.saveCheckIn(checkIn(lastCompleteWeekKey(Date.now()), 1500))
    expect((await repo.currentTargets())?.kcal).toBe(1500)
  })
})

describe('saved meals', () => {
  it('logs a saved meal as ordinary entries at the time given', async () => {
    const food = await chicken()
    await repo.logFood({ food, grams: 200, meal: 'dinner' })
    const entries = await repo.entriesForDay(dayKey(Date.now()))
    const id = await repo.saveMealTemplate('Usual dinner', entries)

    const template = (await repo.mealTemplates()).find((row) => row.id === id)!
    expect(template.nutrients.kcal).toBe(dayTotals(entries).kcal)

    const at = Date.parse('2026-09-01T19:30:00')
    await repo.logMealTemplate(template, 'dinner', at)
    const logged = await repo.entriesForDay('2026-09-01')
    expect(logged).toHaveLength(1)
    expect(logged[0]!.eatenAt).toBe(at)
    expect(logged[0]!.source).toBe('template')
  })
})

describe('relogEntries', () => {
  it('keeps the time of day rather than stamping everything with now', async () => {
    const food = await chicken()
    await repo.logFood({ food, grams: 100, meal: 'lunch', eatenAt: Date.parse('2026-09-01T12:15:00') })
    await repo.logFood({ food, grams: 100, meal: 'lunch', eatenAt: Date.parse('2026-09-01T12:40:00') })

    const source = await repo.entriesForDay('2026-09-01')
    await repo.relogEntries(source, { day: '2026-09-03' })

    const copies = (await repo.entriesForDay('2026-09-03')).sort((a, b) => a.eatenAt - b.eatenAt)
    expect(copies).toHaveLength(2)
    expect(new Date(copies[0]!.eatenAt).getHours()).toBe(12)
    expect(copies[1]!.eatenAt - copies[0]!.eatenAt).toBe(25 * 60_000)
  })
})

describe('forced check-ins', () => {
  it('explains what the week is missing rather than just refusing', async () => {
    const status = await repo.checkInStatus()
    expect(status.daysLogged).toBe(0)
    expect(status.weighIns).toBe(0)
    expect(status.existing).toBeUndefined()
  })

  it('re-runs a week that already has a check-in, overwriting rather than duplicating', async () => {
    const week = lastCompleteWeekKey(Date.now())
    await repo.startProgram({
      goal: 'lose',
      ratePctPerWeek: -0.5,
      proteinGPerKg: 1.8,
      fatMinPctKcal: 25,
    })
    await repo.saveCheckIn({
      weekStart: week,
      expenditureKcal: 2500,
      expenditureSe: 120,
      trendKg: 80,
      trendChangeKgPerWeek: -0.4,
      meanIntakeKcal: 2100,
      daysLogged: 7,
      kcalPerKg: 7700,
      targets: { kcal: 2100, proteinMg: 1, carbsMg: 1, fatMg: 1 },
      status: 'applied',
      note: '',
    })

    // Without data it still can't invent one — but it must not append a second row either.
    await repo.runCheckIn(Date.now(), { force: true })
    expect((await repo.checkIns()).filter((c) => c.weekStart === week)).toHaveLength(1)
  })
})

describe('cycling applies to the day, not the week', () => {
  it('gives a high day more and a low day less, from the same check-in', async () => {
    const programId = await repo.startProgram({
      goal: 'lose',
      ratePctPerWeek: -0.5,
      proteinGPerKg: 1.8,
      fatMinPctKcal: 25,
    })
    await repo.saveCheckIn({
      weekStart: '2026-08-31',
      expenditureKcal: 2500,
      expenditureSe: 100,
      trendKg: 80,
      trendChangeKgPerWeek: -0.4,
      meanIntakeKcal: 2100,
      daysLogged: 7,
      kcalPerKg: 7700,
      targets: { kcal: 2000, proteinMg: 150_000, carbsMg: 200_000, fatMg: 60_000 },
      status: 'applied',
      note: '',
    })

    const flat = await repo.targetsByDay(['2026-09-12', '2026-09-09'])
    expect(flat.get('2026-09-12')!.kcal).toBe(flat.get('2026-09-09')!.kcal)

    // Saturday high.
    await repo.setProgramFields(programId, {
      cycling: { multipliers: multipliersForHighDays([6])! },
    })
    const cycled = await repo.targetsByDay(['2026-09-12', '2026-09-09'])
    expect(cycled.get('2026-09-12')!.kcal).toBeGreaterThan(2000)
    expect(cycled.get('2026-09-09')!.kcal).toBeLessThan(2000)
    // Protein is a floor from bodyweight, not a share of the day.
    expect(cycled.get('2026-09-09')!.proteinMg).toBe(150_000)
  })
})

describe('your own foods', () => {
  it('is searchable and loggable like any other food', async () => {
    const id = await repo.saveCustomFood({
      description: 'Corner shop chicken wrap',
      per100: { ...EMPTY_NUTRIENTS, kcal: 200, proteinMg: 14_000, carbsMg: 20_000, fatMg: 7_000 },
      servingGrams: 250,
      servingLabel: '1 wrap',
    })

    const found = await repo.searchFoods('chicken wrap')
    expect(found.map((f) => f.id)).toContain(id)

    const food = await repo.getFood(id)
    await repo.logFood({ food: food!, meal: 'lunch', portionId: 'custom-serving' })
    const entries = await repo.entriesForDay(dayKey(Date.now()))
    // 250 g of a 200 kcal/100 g food.
    expect(entries[0]!.nutrients.kcal).toBe(500)
  })

  it('stops appearing in search once deleted, without touching what was logged', async () => {
    const id = await repo.saveCustomFood({
      description: 'Weird protein bar',
      per100: { ...EMPTY_NUTRIENTS, kcal: 400, proteinMg: 30_000, carbsMg: 30_000, fatMg: 12_000 },
    })
    const food = await repo.getFood(id)
    await repo.logFood({ food: food!, grams: 100, meal: 'snack' })

    await repo.deleteCustomFood(id)
    expect(await repo.searchFoods('weird protein')).toEqual([])
    expect((await repo.entriesForDay(dayKey(Date.now())))[0]!.nutrients.kcal).toBe(400)
  })
})

describe('searchLibrary', () => {
  it('finds your own recipe by name, which the food database never could', async () => {
    // "lasagna soup" is a recipe the user imported and cooked twice, and searching for it returned
    // USDA's lasagna rows and not theirs — the only way to reach it was to remember it existed.
    const food = await chicken()
    await repo.saveRecipe({
      name: 'Lasagna soup',
      servings: 4,
      ingredients: [{ foodId: food.id, label: food.description, grams: 400 }],
    })
    const hits = await repo.searchLibrary('lasagna soup')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.kind).toBe('recipe')
    expect(hits[0]!.name).toBe('Lasagna soup')
  })

  it('finds saved meals too, and matches terms in any order', async () => {
    const food = await chicken()
    await repo.logFood({ food, grams: 200, meal: 'dinner' })
    await repo.saveMealTemplate('Usual dinner', await repo.entriesForDay(dayKey(Date.now())))
    expect(await repo.searchLibrary('dinner usual')).toHaveLength(1)
  })

  it('matches the name only — an ingredient list is not a name', async () => {
    const food = await chicken()
    await repo.saveRecipe({
      name: 'Sunday tray',
      servings: 2,
      ingredients: [{ foodId: food.id, label: food.description, grams: 400 }],
    })
    // Every recipe with an onion in it turning up for "onion" would make the list useless.
    expect(await repo.searchLibrary('chicken')).toEqual([])
  })

  it('leaves a deleted recipe out', async () => {
    const food = await chicken()
    const id = await repo.saveRecipe({
      name: 'Old tray',
      servings: 2,
      ingredients: [{ foodId: food.id, label: food.description, grams: 100 }],
    })
    await repo.deleteRecipe(id)
    expect(await repo.searchLibrary('old tray')).toEqual([])
  })
})

describe('recipes', () => {
  it('divides the total by servings and logs one serving at a time', async () => {
    const food = await chicken()
    const id = await repo.saveRecipe({
      name: 'Chicken tray',
      servings: 4,
      ingredients: [{ foodId: food.id, label: food.description, grams: 800 }],
    })
    const recipe = (await repo.recipes()).find((r) => r.id === id)!
    const wholeTray = recipe.nutrients.kcal

    await repo.logRecipeIngredients(recipe, 1, 'dinner')
    const [entry] = await repo.entriesForDay(dayKey(Date.now()))
    expect(entry!.nutrients.kcal).toBe(Math.round(wholeTray / 4))
    expect(entry!.source).toBe('recipe')
    // Provenance, not subject: the row's food is the chicken, and the recipe rides alongside.
    expect(entry!.foodId).toBe(food.id)
    expect(entry!.fromRecipeId).toBe(id)
  })

  it('logs a recipe as one named dish over its ingredients', async () => {
    // The whole point of the dish columns: several rows the user reads as one thing they ate. There
    // used to be a second write path producing a single opaque row, and the two disagreed depending
    // on which screen you happened to log from.
    const food = await chicken()
    const id = await repo.saveRecipe({
      name: 'Lasagna soup',
      servings: 2,
      ingredients: [
        { foodId: food.id, label: food.description, grams: 300 },
        { foodId: food.id, label: 'more of the same', grams: 100 },
      ],
    })
    const recipe = (await repo.recipes()).find((r) => r.id === id)!
    await repo.logRecipeIngredients(recipe, 1, 'dinner')

    const rows = await repo.entriesForDay(dayKey(Date.now()))
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((row) => row.dishId)).size).toBe(1)
    expect(rows[0]!.dishId).not.toBeNull()
    expect(rows.every((row) => row.dishName === 'Lasagna soup')).toBe(true)
  })

  it('has this again as a fresh dish, not a second sitting of the old one', async () => {
    const food = await chicken()
    const id = await repo.saveRecipe({
      name: 'Chicken tray',
      servings: 1,
      ingredients: [{ foodId: food.id, label: food.description, grams: 200 }],
    })
    const recipe = (await repo.recipes()).find((r) => r.id === id)!
    await repo.logRecipeIngredients(recipe, 1, 'dinner')
    const first = (await repo.entriesForDay(dayKey(Date.now())))[0]!

    await repo.logDishAgain(first.dishId!)
    const rows = await repo.entriesForDay(dayKey(Date.now()))
    expect(rows).toHaveLength(2)
    // Same name, different id — otherwise logging it again would re-log both sittings next time.
    expect(new Set(rows.map((row) => row.dishId)).size).toBe(2)
    expect(rows.every((row) => row.dishName === 'Chicken tray')).toBe(true)
  })

  it('ignores an ingredient nothing matched rather than guessing at it', async () => {
    const food = await chicken()
    const id = await repo.saveRecipe({
      name: 'Half-known dish',
      servings: 1,
      ingredients: [
        { foodId: food.id, label: food.description, grams: 100 },
        { foodId: null, label: 'unknown sauce', grams: 100 },
      ],
    })
    const recipe = (await repo.recipes()).find((r) => r.id === id)!
    expect(recipe.nutrients.kcal).toBe(nutrientsFor(food, 100).kcal)
  })
})

describe('recentItems', () => {
  it('counts a repeated dish once, rather than once per day', async () => {
    // The list this replaces keyed on `day|meal`, so eating the same lunch on five weekdays produced
    // five rows — none of which named a food — and it grew without bound instead of converging on the
    // handful of things a person actually eats.
    const food = await chicken()
    for (const day of ['2026-09-06', '2026-09-07', '2026-09-08']) {
      const dishId = repo.newDishId()
      const at = Date.parse(`${day}T12:30:00`)
      await repo.logFood({ food, grams: 150, meal: 'lunch', eatenAt: at, dishId, dishName: 'Usual lunch' })
      await repo.logFood({ food, grams: 50, meal: 'lunch', eatenAt: at, dishId, dishName: 'Usual lunch' })
    }

    const items = await repo.recentItems(30, 40)
    const dishes = items.filter((item) => item.kind === 'dish')
    expect(dishes).toHaveLength(1)
    expect(dishes[0]).toMatchObject({ name: 'Usual lunch', times: 3 })
  })

  it('treats a different amount as a different dish', async () => {
    // The signature is the contents, so half a portion is a genuinely different thing to re-log.
    const food = await chicken()
    for (const grams of [150, 300]) {
      const dishId = repo.newDishId()
      await repo.logFood({ food, grams, meal: 'lunch', dishId, dishName: 'Bowl' })
    }
    const dishes = (await repo.recentItems()).filter((item) => item.kind === 'dish')
    expect(dishes).toHaveLength(2)
  })

  it('leaves out a food that has only ever been part of a dish', async () => {
    // "Cheese, Ricotta" is not something anyone logs on its own — it arrived inside the lasagna, and
    // the lasagna is already the row above.
    const food = await chicken()
    await repo.logFood({ food, grams: 100, meal: 'dinner', dishId: repo.newDishId(), dishName: 'Bake' })
    const items = await repo.recentItems()
    expect(items.map((item) => item.kind)).toEqual(['dish'])
  })

  it('remembers the amount a loose food was last eaten in', async () => {
    // Explicit times, because "last" is a fact about the clock. Two rows written in the same
    // millisecond are equally recent and `byRecency` picks between them arbitrarily-but-stably —
    // asserting on that would be asserting on the tie-break rather than on the behaviour.
    const food = await chicken()
    const day = dayKey(Date.now())
    await repo.logFood({ food, grams: 90, meal: 'breakfast', eatenAt: Date.parse(`${day}T08:00:00`) })
    await repo.logFood({ food, grams: 180, meal: 'lunch', eatenAt: Date.parse(`${day}T13:00:00`) })
    const items = await repo.recentItems()
    const row = items.find((item) => item.kind === 'food')
    expect(row).toMatchObject({ times: 2 })
    expect(row?.kind === 'food' ? row.amount?.grams : null).toBe(180)
  })
})

describe('water', () => {
  it('accumulates onto one row per day', async () => {
    const day = dayKey(Date.now())
    await repo.addWater(day, 250)
    await repo.addWater(day, 250)
    expect((await repo.waterForDay(day))?.ml).toBe(500)
    expect(await db.waterLogs.count()).toBe(1)
  })

  it('never goes below zero', async () => {
    const day = dayKey(Date.now())
    await repo.addWater(day, 250)
    await repo.addWater(day, -400)
    expect((await repo.waterForDay(day))?.ml).toBe(0)
  })

  it('re-keys onto the account rather than leaving the old owner in the id', async () => {
    // The id embeds the owner, so re-owning in place would leave `w:local-user:` in it — and the next
    // "+ a glass" would compute a different id, insert a second row, and collide with the server's
    // unique (user_id, day) index.
    await repo.addWater('2026-09-01', 500)
    await repo.claimLocalData('real-user')
    const rows = await db.waterLogs.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe('w:real-user:2026-09-01')
    expect(rows[0]!.userId).toBe('real-user')
    expect(rows[0]!.ml).toBe(500)
  })

  it('keys on the day, so two devices converge rather than accumulate', async () => {
    await repo.addWater('2026-09-01', 500)
    await repo.addWater('2026-09-02', 500)
    expect(await db.waterLogs.count()).toBe(2)
    expect((await repo.waterBetween('2026-09-01', '2026-09-02')).length).toBe(2)
  })
})

describe('editing what was logged', () => {
  const bread = () =>
    givenFoods(
      testFood({
        id: 'usda:test-bread',
        description: 'Sliceable bread',
        portions: [{ id: 'p1', label: 'slice', grams: 28, isDefault: true }],
      }),
    )

  it('keeps the portion when the new amount is a whole number of them', async () => {
    // "2 slices" corrected to 3 must stay 3 slices. It used to become a bare gram figure, which then
    // became the prefill for that food forever after.
    const withPortion = await bread()
    const id = await repo.logFood({ food: withPortion, portionId: 'p1', portionCount: 2, meal: 'breakfast' })

    await repo.updateEntryAmount(id, 84)
    const entry = (await repo.entriesForDay(dayKey(Date.now()))).find((row) => row.id === id)!
    expect(entry.portionId).toBe('p1')
    expect(entry.portionCount).toBe(3)
  })

  it('drops the portion when the amount no longer matches one', async () => {
    const withPortion = await bread()
    const id = await repo.logFood({ food: withPortion, portionId: 'p1', portionCount: 2, meal: 'breakfast' })
    await repo.updateEntryAmount(id, 70)
    const entry = (await repo.entriesForDay(dayKey(Date.now()))).find((row) => row.id === id)!
    expect(entry.portionId).toBeNull()
    expect(entry.grams).toBe(70)
  })

  it('edits a quick add rather than telling the user it cannot be edited', async () => {
    const id = await repo.logQuickAdd({ ...EMPTY_NUTRIENTS, kcal: 520, proteinMg: 30_000 }, 'lunch', 'Canteen stir fry')
    await repo.updateQuickAdd(id, { kcal: 480 })
    const entry = (await repo.entriesForDay(dayKey(Date.now())))[0]!
    // Both copies move together: `nutrients` is what every total reads, `quickAdd` is what the row
    // re-renders from, and letting them drift would show one number and count another.
    expect(entry.nutrients.kcal).toBe(480)
    expect(entry.quickAdd?.kcal).toBe(480)
    expect(entry.nutrients.proteinMg).toBe(30_000)
  })
})

describe('importing weigh-ins from Health', () => {
  it('takes the earliest reading of each day', async () => {
    // Weight climbs through the day; mixing a morning and an evening reading adds noise the
    // trend then has to smooth back out.
    await repo.importWeights([
      { day: '2026-09-01', kg: 81.4, at: Date.parse('2026-09-01T19:00:00') },
      { day: '2026-09-01', kg: 80.2, at: Date.parse('2026-09-01T07:00:00') },
    ])
    const rows = await repo.weights()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.kg).toBe(80.2)
    expect(rows[0]!.source).toBe('apple-health')
  })

  it('never overwrites a weigh-in entered in the app', async () => {
    await repo.recordWeight(80, '2026-09-02')
    await repo.importWeights([
      { day: '2026-09-02', kg: 83, at: Date.parse('2026-09-02T07:00:00') },
    ])
    expect((await repo.weights())[0]!.kg).toBe(80)
  })

  it('updates its own earlier import when the reading changes', async () => {
    await repo.importWeights([
      { day: '2026-09-03', kg: 80, at: Date.parse('2026-09-03T07:00:00') },
    ])
    await repo.importWeights([
      { day: '2026-09-03', kg: 79.6, at: Date.parse('2026-09-03T07:00:00') },
    ])
    const rows = await repo.weights()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.kg).toBe(79.6)
  })
})
