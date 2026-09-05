import { DAY_MS } from '@tracker-engine/core'

/**
 * A weigh-in, one per calendar day. Shared because bodyweight is the join key between the
 * training and nutrition apps: volume for a bodyweight lift needs it, and so does every
 * calorie target. Each app stores its own rows; this owns the definition and the
 * reconciliation, so there is one truth about what a weight *is*.
 */
export interface BodyWeight {
  id: string
  /** Local calendar day, `yyyy-MM-dd`. Unique per user. */
  day: string
  kg: number
  /** Which app the number came from, for display and conflict diagnosis. */
  source: string
  updatedAt: number
  deletedAt: number | null
}

/**
 * Merges two apps' weigh-ins. One row per day wins on `updatedAt` — the same
 * last-write-wins rule the sync engine already applies, so a weight typed in either app
 * behaves identically. Tombstones win at equal time, since deleting is the more
 * deliberate act.
 */
export function reconcile(...sources: readonly BodyWeight[][]): BodyWeight[] {
  const byDay = new Map<string, BodyWeight>()
  for (const row of sources.flat()) {
    const held = byDay.get(row.day)
    if (!held) {
      byDay.set(row.day, row)
      continue
    }
    if (row.updatedAt > held.updatedAt) byDay.set(row.day, row)
    else if (row.updatedAt === held.updatedAt && row.deletedAt !== null) byDay.set(row.day, row)
  }
  return [...byDay.values()]
    .filter((row) => row.deletedAt === null)
    .sort((a, b) => a.day.localeCompare(b.day))
}

export interface TrendPoint {
  day: string
  /** As weighed. */
  kg: number
  /** Smoothed; this is what decisions read. */
  trendKg: number
}

/** Half-life in days of the weight trend. Short enough to react within a week, long
 *  enough that a salty dinner doesn't move a calorie target. */
export const TREND_HALF_LIFE_DAYS = 10

/**
 * Exponentially weighted trend over daily weigh-ins.
 *
 * Daily weight swings ±1–2 kg on water and gut content alone, so no decision should ever
 * read a raw scale value. Gaps are interpolated rather than carried forward: holding the
 * last value flat through a week away would make the trend claim evidence it doesn't have,
 * and then lurch when weighing resumes.
 */
export function weightTrend(
  weights: readonly BodyWeight[],
  halfLifeDays = TREND_HALF_LIFE_DAYS,
): TrendPoint[] {
  const rows = [...weights]
    .filter((w) => w.deletedAt === null)
    .sort((a, b) => a.day.localeCompare(b.day))
  if (rows.length === 0) return []

  const alpha = 1 - Math.pow(2, -1 / halfLifeDays)
  const out: TrendPoint[] = []
  let trend = rows[0]!.kg

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!
    if (i > 0) {
      // One step per elapsed day, so a gap decays toward the new reading at the same rate
      // daily weighing would have.
      const gapDays = Math.max(1, Math.round((dayMs(row.day) - dayMs(rows[i - 1]!.day)) / DAY_MS))
      for (let step = 0; step < gapDays; step += 1) trend += alpha * (row.kg - trend)
    }
    out.push({ day: row.day, kg: row.kg, trendKg: trend })
  }
  return out
}

function dayMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`)
}

/** Trend change in kg/week across the window, or null with too little to say. */
export function trendChangePerWeek(trend: readonly TrendPoint[]): number | null {
  if (trend.length < 2) return null
  const first = trend[0]!
  const last = trend[trend.length - 1]!
  const days = (dayMs(last.day) - dayMs(first.day)) / DAY_MS
  if (days <= 0) return null
  return ((last.trendKg - first.trendKg) / days) * 7
}
