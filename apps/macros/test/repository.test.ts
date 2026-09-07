import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import * as repo from '@/data/repository'
import { seedFoods } from '@/db/seed'
import { dayKey } from '@tracker-engine/core'
import { dayTotals } from '@/lib/nutrition'
import { lastCompleteWeekKey } from '@/lib/checkin'
import { EMPTY_NUTRIENTS } from '@/domain/types'

async function reset() {
  await Promise.all(db.tables.map((t) => t.clear()))
  localStorage.clear()
  await seedFoods()
  repo.setActiveUserId('local-user')
}

beforeEach(reset)

async function chicken() {
  const [food] = await repo.searchFoods('chicken breast')
  if (!food) throw new Error('seed missing')
  return food
}

describe('seedFoods', () => {
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
