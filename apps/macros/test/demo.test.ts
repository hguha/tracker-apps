import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import * as repo from '@/data/repository'
import { seedFoods } from '@/db/seed'
import { loadDemoData } from '@/data/demo'
import { buildDemoPlan, DEMO_DAYS, DEMO_RECIPES } from '@/lib/demoData'
import { dayTotals } from '@/lib/nutrition'
import { ONBOARDING_VERSION } from '@/domain/types'

// Once per file. `foods` is reference data nobody owns, so re-seeding 1,400 rows between tests is
// pure cost — and with a generated seed that cost grew enough to time them out.
beforeAll(async () => {
  await seedFoods()
})

beforeEach(async () => {
  await Promise.all(db.tables.filter((table) => table.name !== 'foods').map((t) => t.clear()))
  localStorage.clear()
  repo.setActiveUserId('local-user')
})

describe('buildDemoPlan', () => {
  it('is deterministic, so the demo can be talked about', () => {
    expect(buildDemoPlan(1_770_000_000_000)).toEqual(buildDemoPlan(1_770_000_000_000))
  })

  it('leaves gaps, because the algorithm has to cope with them', () => {
    const plan = buildDemoPlan(1_770_000_000_000)
    expect(plan.days.filter((d) => d.entries.length === 0).length).toBeGreaterThan(0)
    expect(plan.days.filter((d) => d.weightKg === null).length).toBeGreaterThan(0)
  })

  it('trends down with daily scatter, not a clean line', () => {
    const weights = buildDemoPlan(1_770_000_000_000)
      .days.map((d) => d.weightKg)
      .filter((kg): kg is number => kg !== null)
    expect(weights[0]!).toBeGreaterThan(weights[weights.length - 1]!)
    // Some day must go up, or the weight trend has nothing to smooth.
    expect(weights.some((kg, i) => i > 0 && kg > weights[i - 1]!)).toBe(true)
  })
})

describe('loadDemoData', () => {
  it('writes through the repository, so rows sync like any other', async () => {
    const { entries } = await loadDemoData()
    expect(entries).toBeGreaterThan(100)
    // Queued for sync: a fixture that bypassed the write path would prove nothing.
    expect(await db.outbox.count()).toBeGreaterThan(entries)
  })

  it('produces days with plausible calories', async () => {
    await loadDemoData()
    const plan = buildDemoPlan()
    const logged = plan.days.filter((d) => d.entries.length > 0)
    const totals = dayTotals(await repo.entriesForDay(logged[0]!.day))
    expect(totals.kcal).toBeGreaterThan(1400)
    expect(totals.kcal).toBeLessThan(3600)
  })

  it('sets up a program and the cold-start facts', async () => {
    await loadDemoData()
    expect((await repo.activeProgram())?.goal).toBe('lose')
    const profile = await repo.getProfile()
    expect(profile.heightCm).toBe(180)
    expect(profile.dietNotes).toContain('shellfish')
  })

  it('leaves the history with real targets, not an empty app', async () => {
    await loadDemoData()
    const checkIns = await repo.checkIns()
    expect(checkIns.length).toBeGreaterThan(0)
    const targets = await repo.currentTargets()
    expect(targets!.kcal).toBeGreaterThan(1200)
    // Measured, and below expenditure because the program is a deficit.
    const applied = checkIns.filter((c) => c.status === 'applied')
    expect(applied[0]!.expenditureKcal).toBeGreaterThan(applied[0]!.targets.kcal)
  })

  it('leaves setup finished, so the reload lands on the app and not on onboarding', async () => {
    await loadDemoData()
    // This was `1` against an app that requires 3: loading the demo bounced you into setup, and
    // finishing setup then overwrote the profile the demo had just written.
    expect((await repo.getProfile()).onboardingVersion).toBe(ONBOARDING_VERSION)
    expect((await repo.getProfile()).onboardedAt).not.toBeNull()
  })

  it('records weigh-ins across the window', async () => {
    await loadDemoData()
    expect((await repo.weights()).length).toBeGreaterThan(DEMO_DAYS / 2)
  })
})

describe('the demo cooks, and eats out', () => {
  it('saves its recipes with matched foods and a cuisine', async () => {
    await loadDemoData()
    const recipes = await repo.recipes()
    // A set, not a list: `recipes()` comes back in primary-key order, and the ids are random.
    expect(new Set(recipes.map((recipe) => recipe.name))).toEqual(
      new Set(DEMO_RECIPES.map((recipe) => recipe.name)),
    )
    // Every line matched a seeded food. A null here means staples.ts was regenerated and the
    // demo's exact descriptions no longer exist — which is what that file exists to prevent.
    expect(recipes.flatMap((r) => r.ingredients).every((line) => line.foodId !== null)).toBe(true)
    expect(recipes.every((recipe) => recipe.nutrients.kcal > 0)).toBe(true)
    expect(recipes.some((recipe) => recipe.cuisine === 'mexican')).toBe(true)
  })

  it('logs cooked dinners as dishes, so a day reads as meals and not as ingredients', async () => {
    await loadDemoData()
    const dishes = new Set(
      (await repo.allEntries()).filter((e) => e.dishId !== null).map((e) => e.dishName),
    )
    expect(dishes.size).toBeGreaterThan(1)
    // And they stay attached to the recipe, which is what "what you cook" counts.
    const cooked = (await repo.allEntries()).filter((e) => e.fromRecipeId !== null)
    expect(cooked.length).toBeGreaterThan(10)
  })

  it('records where dinner was eaten, including the nights out', async () => {
    await loadDemoData()
    const venues = new Set((await repo.allEntries()).map((entry) => entry.venue))
    expect(venues.has('home')).toBe(true)
    expect(venues.has('restaurant')).toBe(true)
    // Unrecorded is the one value that must not be the commonest: it used to be all of them.
    expect(venues.has(null)).toBe(false)
  })

  it('drinks water, so the card and its chart have something to show', async () => {
    await loadDemoData()
    const rows = await repo.waterBetween(buildDemoPlan().days[0]!.day, buildDemoPlan().days.at(-1)!.day)
    expect(rows.filter((row) => row.ml > 0).length).toBeGreaterThan(DEMO_DAYS / 2)
    expect((await repo.getProfile()).waterTargetMl).toBeGreaterThan(0)
  })

  it('spreads meals across the day rather than stamping them all at noon', async () => {
    await loadDemoData()
    const hours = new Set(
      (await repo.allEntries()).map((entry) => new Date(entry.eatenAt).getHours()),
    )
    expect(hours.size).toBeGreaterThan(2)
  })
})
