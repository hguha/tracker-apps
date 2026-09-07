import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import * as repo from '@/data/repository'
import { seedFoods } from '@/db/seed'
import { loadDemoData } from '@/data/demo'
import { buildDemoPlan, DEMO_DAYS } from '@/lib/demoData'
import { dayTotals } from '@/lib/nutrition'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  localStorage.clear()
  await seedFoods()
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

  it('records weigh-ins across the window', async () => {
    await loadDemoData()
    expect((await repo.weights()).length).toBeGreaterThan(DEMO_DAYS / 2)
  })
})
