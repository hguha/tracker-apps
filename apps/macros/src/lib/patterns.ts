import { groupBy } from '@tracker-engine/core'
import { eatingOccasions } from '@/lib/mealTiming'
import type { CuisineKey, LogEntry, MacroTargets, Venue } from '@/domain/types'

/**
 * Where you eat, and what kind of food it is.
 *
 * The interesting question is not the split itself — everyone can guess roughly how often they eat
 * out — but what it costs: whether the days with a restaurant meal in them run over, and by how
 * much. That comparison is the whole reason the venue field exists, so it's computed here rather
 * than inside a chart, where the coach couldn't reach it.
 *
 * Counted by *occasion*, never by row. A restaurant meal logged as six items would otherwise
 * outvote a home dinner logged as one, and the resulting chart would measure how the user happened
 * to log rather than where they ate.
 */

interface VenueBreakdown {
  venue: Venue | null
  occasions: number
  kcal: number
  /** Per occasion — the figure that actually distinguishes a restaurant from a kitchen. */
  meanKcal: number
}

export interface VenueSummary {
  breakdown: VenueBreakdown[]
  /** Share of occasions with a venue recorded. Below this, nothing else here means much. */
  recordedPct: number
  /** Days containing at least one restaurant or takeaway occasion. */
  outDays: DaySide
  /** Days where everything recorded was cooked at home. Days with nothing recorded are in neither. */
  homeDays: DaySide
}

export interface DaySide {
  days: number
  /** Mean intake across those days. Null when there are none. */
  meanKcal: number | null
  /** Mean kcal over target across those days, ignoring days with no target. Null when none. */
  meanOverTarget: number | null
}

/** A venue that isn't your own kitchen. */
const isOut = (venue: Venue | null): boolean => venue === 'restaurant' || venue === 'takeaway'

export function venueSummary(
  entries: readonly LogEntry[],
  targetsByDay: ReadonlyMap<string, MacroTargets | null>,
): VenueSummary {
  const byDay = groupBy(entries, (entry) => entry.day)

  const tally = new Map<string, { occasions: number; kcal: number }>()
  const outDayKeys: string[] = []
  const homeDayKeys: string[] = []

  for (const [day, rows] of byDay) {
    const occasions = eatingOccasions(rows)
    let sawOut = false
    let sawAny = false
    for (const occasion of occasions) {
      // One venue per sitting: repo.setVenue writes them together, and the first row is the
      // sitting's answer even if a later row was logged before the venue was recorded.
      const venue = occasion.entries.find((entry) => entry.venue !== null)?.venue ?? null
      const key = venue ?? UNRECORDED
      const current = tally.get(key) ?? { occasions: 0, kcal: 0 }
      tally.set(key, {
        occasions: current.occasions + 1,
        kcal: current.kcal + occasion.nutrients.kcal,
      })
      if (venue !== null) sawAny = true
      if (isOut(venue)) sawOut = true
    }
    if (sawOut) outDayKeys.push(day)
    else if (sawAny) homeDayKeys.push(day)
  }

  const total = [...tally.values()].reduce((sum, row) => sum + row.occasions, 0)
  const unrecorded = tally.get(UNRECORDED)?.occasions ?? 0

  return {
    breakdown: [...tally.entries()]
      .map(([key, row]) => ({
        venue: key === UNRECORDED ? null : (key as Venue),
        occasions: row.occasions,
        kcal: row.kcal,
        meanKcal: Math.round(row.kcal / Math.max(1, row.occasions)),
      }))
      .sort((a, b) => b.occasions - a.occasions),
    recordedPct: total === 0 ? 0 : ((total - unrecorded) / total) * 100,
    outDays: side(outDayKeys, byDay, targetsByDay),
    homeDays: side(homeDayKeys, byDay, targetsByDay),
  }
}

const UNRECORDED = '—'

function side(
  dayKeys: readonly string[],
  byDay: ReadonlyMap<string, LogEntry[]>,
  targetsByDay: ReadonlyMap<string, MacroTargets | null>,
): DaySide {
  if (dayKeys.length === 0) return { days: 0, meanKcal: null, meanOverTarget: null }

  let kcal = 0
  let overSum = 0
  let overDays = 0
  for (const day of dayKeys) {
    const total = (byDay.get(day) ?? []).reduce((sum, entry) => sum + entry.nutrients.kcal, 0)
    kcal += total
    const target = targetsByDay.get(day)
    if (target) {
      overSum += total - target.kcal
      overDays += 1
    }
  }

  return {
    days: dayKeys.length,
    meanKcal: Math.round(kcal / dayKeys.length),
    meanOverTarget: overDays === 0 ? null : Math.round(overSum / overDays),
  }
}

export interface CuisineShare {
  cuisine: CuisineKey | null
  occasions: number
  kcal: number
}

/**
 * What kinds of food, from the recipes actually logged.
 *
 * Only recipe entries carry a cuisine, so this is honest about being a picture of what you *cook*
 * rather than everything you eat — inferring "Italian" from a row called "Pasta, dry, enriched"
 * would be inventing the very data the chart claims to show.
 */
export function cuisineMix(
  entries: readonly LogEntry[],
  cuisineOf: ReadonlyMap<string, CuisineKey | null>,
): CuisineShare[] {
  const tally = new Map<string, { occasions: number; kcal: number }>()

  /**
   * One serving per recipe *sitting*, not per row.
   *
   * A recipe can be logged as one row or as nine ingredient rows, and the second is now the default.
   * Counting rows would report the same dinner as nine servings of Italian, so servings are grouped
   * by (recipe, day, minute) — the same reasoning as counting venues by occasion.
   */
  const seen = new Set<string>()
  for (const entry of entries) {
    const recipeId = entry.recipeId ?? entry.fromRecipeId
    if (!recipeId) continue
    const key = cuisineOf.get(recipeId) ?? UNRECORDED
    const sitting = `${recipeId}|${entry.day}|${Math.round(entry.eatenAt / 60_000)}`
    const current = tally.get(key) ?? { occasions: 0, kcal: 0 }
    tally.set(key, {
      occasions: current.occasions + (seen.has(sitting) ? 0 : 1),
      kcal: current.kcal + entry.nutrients.kcal,
    })
    seen.add(sitting)
  }
  return [...tally.entries()]
    .map(([key, row]) => ({
      cuisine: key === UNRECORDED ? null : (key as CuisineKey),
      ...row,
    }))
    .sort((a, b) => b.occasions - a.occasions)
}
