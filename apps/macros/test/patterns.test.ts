import { describe, expect, it } from 'vitest'
import { cuisineMix, venueSummary } from '@/lib/patterns'
import { EMPTY_NUTRIENTS, type CuisineKey, type LogEntry, type MacroTargets, type Venue } from '@/domain/types'

function entry(options: {
  day: string
  hour: number
  kcal: number
  venue?: Venue | null
  recipeId?: string | null
}): LogEntry {
  const eatenAt = Date.parse(`${options.day}T${String(options.hour).padStart(2, '0')}:00:00`)
  return {
    id: `${options.day}:${options.hour}:${options.kcal}`,
    userId: 'u',
    day: options.day,
    eatenAt,
    meal: 'dinner',
    sortIndex: eatenAt,
    foodId: options.recipeId ? null : 'usda:1',
    recipeId: options.recipeId ?? null,
    quickAdd: null,
    grams: 100,
    portionId: null,
    portionCount: null,
    nutrients: { ...EMPTY_NUTRIENTS, kcal: options.kcal },
    source: 'search',
    estimate: null,
    venue: options.venue ?? null,
    note: '',
    createdAt: eatenAt,
    updatedAt: eatenAt,
    deletedAt: null,
    clientRev: 1,
  }
}

const target = (kcal: number): MacroTargets => ({
  kcal,
  proteinMg: 0,
  carbsMg: 0,
  fatMg: 0,
})

describe('venueSummary', () => {
  it('counts sittings, not rows, so a six-item restaurant meal counts once', () => {
    const summary = venueSummary(
      [
        entry({ day: '2026-09-01', hour: 19, kcal: 200, venue: 'restaurant' }),
        entry({ day: '2026-09-01', hour: 19, kcal: 300, venue: 'restaurant' }),
        entry({ day: '2026-09-01', hour: 19, kcal: 400, venue: 'restaurant' }),
      ],
      new Map(),
    )
    const out = summary.breakdown.find((row) => row.venue === 'restaurant')!
    expect(out.occasions).toBe(1)
    expect(out.kcal).toBe(900)
    expect(out.meanKcal).toBe(900)
  })

  it('reports how much is recorded, and does not count unset as home', () => {
    const summary = venueSummary(
      [
        entry({ day: '2026-09-01', hour: 8, kcal: 300, venue: 'home' }),
        entry({ day: '2026-09-01', hour: 13, kcal: 500 }),
      ],
      new Map(),
    )
    expect(summary.recordedPct).toBe(50)
    expect(summary.breakdown.find((row) => row.venue === null)?.occasions).toBe(1)
  })

  it('compares days with a meal out against days entirely at home', () => {
    const summary = venueSummary(
      [
        entry({ day: '2026-09-01', hour: 19, kcal: 1400, venue: 'restaurant' }),
        entry({ day: '2026-09-02', hour: 19, kcal: 900, venue: 'home' }),
      ],
      new Map([
        ['2026-09-01', target(1000)],
        ['2026-09-02', target(1000)],
      ]),
    )
    expect(summary.outDays).toEqual({ days: 1, meanKcal: 1400, meanOverTarget: 400 })
    expect(summary.homeDays).toEqual({ days: 1, meanKcal: 900, meanOverTarget: -100 })
  })

  it('counts a takeaway as eating out', () => {
    const summary = venueSummary(
      [entry({ day: '2026-09-01', hour: 20, kcal: 1100, venue: 'takeaway' })],
      new Map(),
    )
    expect(summary.outDays.days).toBe(1)
    expect(summary.homeDays.days).toBe(0)
  })

  it('puts a day with nothing recorded on neither side', () => {
    const summary = venueSummary([entry({ day: '2026-09-01', hour: 20, kcal: 800 })], new Map())
    expect(summary.outDays.days).toBe(0)
    expect(summary.homeDays.days).toBe(0)
  })

  it('files a whole sitting by its one recorded venue', () => {
    // repo.setVenue writes them together, but a row logged before the answer stays null.
    const summary = venueSummary(
      [
        entry({ day: '2026-09-01', hour: 19, kcal: 300, venue: null }),
        entry({ day: '2026-09-01', hour: 19, kcal: 300, venue: 'restaurant' }),
      ],
      new Map(),
    )
    expect(summary.breakdown).toEqual([
      { venue: 'restaurant', occasions: 1, kcal: 600, meanKcal: 600 },
    ])
    expect(summary.recordedPct).toBe(100)
  })

  it('leaves everything null and empty with nothing logged', () => {
    const summary = venueSummary([], new Map())
    expect(summary.breakdown).toEqual([])
    expect(summary.recordedPct).toBe(0)
    expect(summary.outDays.meanKcal).toBeNull()
  })
})

describe('cuisineMix', () => {
  const cuisines = new Map<string, CuisineKey | null>([
    ['r1', 'italian'],
    ['r2', 'indian'],
    ['r3', null],
  ])

  it('counts recipe servings by cuisine, busiest first', () => {
    const mix = cuisineMix(
      [
        entry({ day: '2026-09-01', hour: 19, kcal: 600, recipeId: 'r1' }),
        entry({ day: '2026-09-02', hour: 19, kcal: 500, recipeId: 'r1' }),
        entry({ day: '2026-09-03', hour: 19, kcal: 700, recipeId: 'r2' }),
      ],
      cuisines,
    )
    expect(mix).toEqual([
      { cuisine: 'italian', occasions: 2, kcal: 1100 },
      { cuisine: 'indian', occasions: 1, kcal: 700 },
    ])
  })

  it('ignores food entries, which carry no cuisine to read', () => {
    const mix = cuisineMix([entry({ day: '2026-09-01', hour: 13, kcal: 400 })], cuisines)
    expect(mix).toEqual([])
  })

  it('keeps recipes with no cuisine as their own row rather than dropping them', () => {
    const mix = cuisineMix(
      [entry({ day: '2026-09-01', hour: 19, kcal: 400, recipeId: 'r3' })],
      cuisines,
    )
    expect(mix).toEqual([{ cuisine: null, occasions: 1, kcal: 400 }])
  })
})
