import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { dayKey, dayKeyOffset, groupBy } from '@tracker-engine/core'
import { weightTrend, type TrendPoint } from '@tracker-engine/body'
import * as repo from '@/data/repository'
import {
  dailyAverageCovered,
  mgToGrams,
  sumCovered,
  type CoveredNutrients,
} from '@/lib/nutrition'
import { groupByWeek } from '@/lib/checkin'
import { filterExpenditure, kcalPerKg, windowEstimate, type ExpenditureWindow } from '@/lib/expenditure'
import { eatingOccasions, minutesIntoDay } from '@/lib/mealTiming'
import { cuisineMix, venueSummary, type CuisineShare, type VenueSummary } from '@/lib/patterns'
import { entryName } from '@/features/shared/entryName'
import { useEntriesWithFoods } from '@/features/shared/useEntriesWithFoods'
import type { GoalForecast } from '@/lib/goal'
import type { CuisineKey, LogEntry, MacroTargets, Profile, Program } from '@/domain/types'

/**
 * Everything the Insights charts read, computed once.
 *
 * One hook rather than a query per chart, because the charts have to agree: the expenditure
 * figure here is folded from the same weekly windows the check-in uses, grouped by the same
 * week boundaries. Two screens computing that separately is precisely the bug REPutation shipped
 * (a coach and a home screen reporting different weekly volumes).
 */

export interface InsightsDay {
  day: string
  kcal: number
  protein: number
  carbs: number
  fat: number
  /** Null only when *nothing* that day recorded fibre — never zero (see lib/nutrition). */
  fiber: number | null
  /** Share of the day's calories from foods that reported fibre, 0–1. */
  fiberCoverage: number
  targetKcal: number | null
  targetProtein: number | null
  occasions: number
  firstMinute: number | null
  lastMinute: number | null
}

/** One day's water, in millilitres. Null when nothing was logged — never zero. */
export interface WaterDay {
  day: string
  ml: number | null
}

export interface InsightsData {
  days: InsightsDay[]
  water: WaterDay[]
  trend: TrendPoint[]
  windows: ExpenditureWindow[]
  expenditureKcal: number | null
  expenditureSe: number | null
  energyPerKg: number
  program: Program | undefined
  forecast: GoalForecast | null
  profile: Profile | undefined
  /** Per-day average over the window, with per-nutrient coverage — see `sumCovered`. */
  nutrition: CoveredNutrients
  loggedDayCount: number
  /** kcal eaten in each hour of the day, summed across the window. */
  kcalByHour: number[]
  /** How entries were logged, for the habit tab: search, barcode, describe, quick, … */
  sourceCounts: { source: string; count: number }[]
  /** Trend change across the window, in kg. Null with fewer than two weigh-ins. */
  weightChangeKg: number | null
  /** Share of days with a target that landed within 10% of it. Null when no day had one. */
  adherencePct: number | null
  entries: LogEntry[]
  /** The foods contributing the most calories over the window. */
  topFoods: { name: string; kcal: number; entries: number }[]
  /** Home vs out, by occasion, and what each side costs against target. */
  venues: VenueSummary
  /** The cuisines of the recipes logged — what you cook, not everything you eat. */
  cuisines: CuisineShare[]
}

export function useInsightsData(windowDays: number): InsightsData {
  const from = dayKeyOffset(Date.now(), windowDays - 1)
  const today = dayKey(Date.now())

  const loaded = useEntriesWithFoods(from, today)
  const entries = loaded?.entries
  const foods = loaded?.foods
  const weights = useLiveQuery(() => repo.weights(), [], [])
  const program = useLiveQuery(() => repo.activeProgram(), [], undefined)
  const forecast = useLiveQuery(() => repo.goalOutlook(), [], null)
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)
  const waterRows = useLiveQuery(() => repo.waterBetween(from, today), [from, today], [])

  const byDay = useMemo(() => groupBy(entries ?? [], (entry) => entry.day), [entries])
  const dayKeys = useMemo(() => [...byDay.keys()].sort(), [byDay])
  const targetsByDay = useLiveQuery(
    () => repo.targetsByDay(dayKeys),
    [dayKeys.join(',')],
    new Map<string, MacroTargets | null>(),
  )

  const days = useMemo(
    (): InsightsDay[] =>
      dayKeys.map((day) => {
        const rows = byDay.get(day) ?? []
        const occasions = eatingOccasions(rows)
        const target = targetsByDay.get(day) ?? null
        // Covered, not strict: one taco ingredient with no fibre figure used to drop the entire day
        // off the fibre chart. See `sumCovered`.
        const { totals, coverage } = sumCovered(rows.map((row) => row.nutrients))
        return {
          day,
          kcal: totals.kcal,
          protein: mgToGrams(totals.proteinMg),
          carbs: mgToGrams(totals.carbsMg),
          fat: mgToGrams(totals.fatMg),
          fiber: totals.fiberMg === null ? null : mgToGrams(totals.fiberMg),
          fiberCoverage: coverage.fiberMg,
          targetKcal: target?.kcal ?? null,
          targetProtein: target ? mgToGrams(target.proteinMg) : null,
          occasions: occasions.length,
          firstMinute: occasions.length > 0 ? minutesIntoDay(occasions[0]!.startAt) : null,
          lastMinute:
            occasions.length > 0 ? minutesIntoDay(occasions[occasions.length - 1]!.endAt) : null,
        }
      }),
    [byDay, dayKeys, targetsByDay],
  )

  // Smoothed once over the whole history, then sliced by week: smoothing inside a week re-seeds
  // the EWMA and destroys the signal, which understated expenditure by ~400 kcal/day.
  const trend = weightTrend(weights)
  const energyPerKg = kcalPerKg(program?.goal ?? 'maintain', program?.ratePctPerWeek ?? 0)
  const intakeWeeks = groupByWeek(
    days.map((day) => ({ day: day.day, kcal: day.kcal })),
    (day) => day.day,
  )
  const trendWeeks = groupByWeek(trend, (point) => point.day)
  const windows = [...new Set([...intakeWeeks.keys(), ...trendWeeks.keys()])]
    .sort()
    .map((week) =>
      windowEstimate(week, intakeWeeks.get(week) ?? [], trendWeeks.get(week) ?? [], energyPerKg),
    )
    .filter((window): window is ExpenditureWindow => window !== null)
  const expenditure = filterExpenditure(windows, null)

  const kcalByHour = Array.from({ length: 24 }, () => 0)
  for (const entry of entries ?? []) {
    const hour = new Date(entry.eatenAt).getHours()
    kcalByHour[hour] = (kcalByHour[hour] ?? 0) + entry.nutrients.kcal
  }

  const contribution = new Map<string, { kcal: number; entries: number }>()
  for (const entry of entries ?? []) {
    const name = entryName(entry, foods ?? new Map())
    const current = contribution.get(name) ?? { kcal: 0, entries: 0 }
    contribution.set(name, {
      kcal: current.kcal + entry.nutrients.kcal,
      entries: current.entries + 1,
    })
  }

  const sourceTally = new Map<string, number>()
  for (const entry of entries ?? []) {
    sourceTally.set(entry.source, (sourceTally.get(entry.source) ?? 0) + 1)
  }

  const recipes = useLiveQuery(() => repo.recipes(), [], [])
  const cuisineOf = new Map<string, CuisineKey | null>(
    recipes.map((recipe) => [recipe.id, recipe.cuisine]),
  )

  const waterByDay = new Map(waterRows.map((row) => [row.day, row.ml]))
  const scored = days.filter((day) => day.targetKcal !== null)
  const first = trend[0]
  const last = trend[trend.length - 1]

  return {
    days,
    /**
     * The union of days with food and days with water, so a day of only water still appears.
     *
     * A gap rather than a zero for a day nothing was recorded — "didn't log it" and "drank none" are
     * different facts, and a run of zeroes would make the first look like the second.
     */
    water: [...new Set([...dayKeys, ...waterByDay.keys()])]
      .sort()
      .map((day) => ({ day, ml: waterByDay.get(day) ?? null })),
    trend,
    windows,
    expenditureKcal: expenditure?.kcal ?? null,
    expenditureSe: expenditure?.se ?? null,
    program,
    forecast,
    energyPerKg,
    profile,
    nutrition: dailyAverageCovered(entries ?? []),
    loggedDayCount: dayKeys.length,
    kcalByHour,
    sourceCounts: [...sourceTally.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count),
    weightChangeKg: first && last && trend.length > 1 ? last.trendKg - first.trendKg : null,
    entries: entries ?? [],
    topFoods: [...contribution.entries()]
      .map(([name, value]) => ({ name, ...value }))
      .sort((a, b) => b.kcal - a.kcal)
      .slice(0, 12),
    venues: venueSummary(entries ?? [], targetsByDay),
    cuisines: cuisineMix(entries ?? [], cuisineOf),
    adherencePct:
      scored.length === 0
        ? null
        : (scored.filter((day) => Math.abs(day.kcal - day.targetKcal!) <= day.targetKcal! * 0.1)
            .length /
            scored.length) *
          100,
  }
}

export const meanKcal = (days: readonly InsightsDay[]): number =>
  days.length === 0 ? 0 : Math.round(days.reduce((sum, day) => sum + day.kcal, 0) / days.length)
