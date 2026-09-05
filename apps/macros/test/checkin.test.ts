import { describe, expect, it } from 'vitest'
import {
  buildCheckIn,
  currentWeekKey,
  lastCompleteWeekKey,
  type CheckInInputs,
} from '@/lib/checkin'
import type { BodyWeight } from '@tracker-engine/body'
import type { CheckIn, Program } from '@/domain/types'

// A Wednesday, so "the week that just ended" is unambiguous.
const NOW = Date.parse('2026-09-02T09:00:00')

function program(over: Partial<Program> = {}): Program {
  return {
    id: 'p1',
    userId: 'u1',
    goal: 'lose',
    ratePctPerWeek: -0.5,
    startedAt: 0,
    endedAt: null,
    coachingMode: 'coached',
    proteinGPerKg: 1.8,
    fatMinPctKcal: 25,
    cycling: null,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    clientRev: 1,
    ...over,
  }
}

/** `days` consecutive daily weigh-ins ending the day before NOW. */
function weights(startKg: number, perDay: number, days = 21): BodyWeight[] {
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(NOW - (days - i) * 86_400_000)
    return {
      id: `w${i}`,
      day: date.toISOString().slice(0, 10),
      kg: startKg + perDay * i,
      source: 'macros',
      updatedAt: 1,
      deletedAt: null,
    }
  })
}

function intake(kcal: number, days = 21) {
  return Array.from({ length: days }, (_, i) => ({
    day: new Date(NOW - (days - i) * 86_400_000).toISOString().slice(0, 10),
    kcal,
  }))
}

function inputs(over: Partial<CheckInInputs> = {}): CheckInInputs {
  return {
    now: NOW,
    program: program(),
    profile: { heightCm: 180, birthYear: 1996, sex: 'male' },
    weights: weights(80, -0.07),
    intake: intake(2200),
    prior: null,
    ...over,
  }
}

describe('week boundaries', () => {
  it('checks in about the week that already ended, not the live one', () => {
    expect(lastCompleteWeekKey(NOW) < currentWeekKey(NOW)).toBe(true)
  })
})

describe('buildCheckIn', () => {
  it('refuses without any weigh-in', () => {
    const outcome = buildCheckIn(inputs({ weights: [] }))
    expect(outcome.kind).toBe('not-enough-data')
  })

  it('refuses when the week is too sparsely logged', () => {
    const outcome = buildCheckIn(inputs({ intake: intake(2200, 2), weights: weights(80, 0, 2) }))
    expect(outcome.kind).toBe('not-enough-data')
  })

  it('measures expenditure above intake while weight is falling', () => {
    const outcome = buildCheckIn(inputs())
    if (outcome.kind !== 'ready') throw new Error(outcome.reason)
    expect(outcome.draft.expenditureKcal).toBeGreaterThan(2200)
    expect(outcome.draft.expenditureSe).toBeGreaterThan(0)
  })

  it('sets a target below expenditure for a deficit', () => {
    const outcome = buildCheckIn(inputs())
    if (outcome.kind !== 'ready') throw new Error(outcome.reason)
    expect(outcome.draft.targets.kcal).toBeLessThan(outcome.draft.expenditureKcal)
  })

  it('sets a target above expenditure for a surplus', () => {
    const outcome = buildCheckIn(
      inputs({
        program: program({ goal: 'gain', ratePctPerWeek: 0.25 }),
        weights: weights(80, 0.03),
      }),
    )
    if (outcome.kind !== 'ready') throw new Error(outcome.reason)
    expect(outcome.draft.targets.kcal).toBeGreaterThan(outcome.draft.expenditureKcal)
  })

  it('records the energy density it used, so a later change cannot rewrite the week', () => {
    const outcome = buildCheckIn(inputs())
    if (outcome.kind !== 'ready') throw new Error(outcome.reason)
    expect(outcome.draft.kcalPerKg).toBe(7700)
  })

  it('applies automatically when coached, and waits when collaborative', () => {
    const coached = buildCheckIn(inputs())
    const collaborative = buildCheckIn(
      inputs({ program: program({ coachingMode: 'collaborative' }) }),
    )
    if (coached.kind !== 'ready' || collaborative.kind !== 'ready') throw new Error('no draft')
    expect(coached.draft.status).toBe('applied')
    expect(collaborative.draft.status).toBe('proposed')
  })

  it('steps gradually from the target already in force', () => {
    const prior: CheckIn = {
      id: 'c1',
      userId: 'u1',
      weekStart: '2026-08-17',
      expenditureKcal: 2000,
      expenditureSe: 120,
      trendKg: 80,
      trendChangeKgPerWeek: 0,
      meanIntakeKcal: 2000,
      daysLogged: 7,
      kcalPerKg: 7700,
      targets: { kcal: 1800, proteinMg: 0, carbsMg: 0, fatMg: 0 },
      status: 'applied',
      note: '',
      createdAt: 0,
      updatedAt: 0,
      deletedAt: null,
      clientRev: 1,
    }
    // Intake far above the old target, so the raw proposal would jump hundreds of kcal.
    const outcome = buildCheckIn(inputs({ prior, intake: intake(3200) }))
    if (outcome.kind !== 'ready') throw new Error(outcome.reason)
    expect(outcome.draft.targets.kcal - prior.targets.kcal).toBeLessThanOrEqual(150)
  })

  it('splits protein from the weight trend, not the last scale reading', () => {
    const outcome = buildCheckIn(inputs())
    if (outcome.kind !== 'ready') throw new Error(outcome.reason)
    const proteinG = outcome.draft.targets.proteinMg / 1000
    expect(proteinG).toBeCloseTo(1.8 * outcome.draft.trendKg, 0)
  })

  it('explains itself, because an unexplained target gets ignored', () => {
    const outcome = buildCheckIn(inputs())
    if (outcome.kind !== 'ready') throw new Error(outcome.reason)
    expect(outcome.draft.note).toMatch(/kg\/week/)
    expect(outcome.draft.note).toMatch(/expenditure measured/)
  })

  it('still works with no profile, just without a cold-start prior', () => {
    const outcome = buildCheckIn(
      inputs({ profile: { heightCm: null, birthYear: null, sex: null } }),
    )
    expect(outcome.kind).toBe('ready')
  })
})
