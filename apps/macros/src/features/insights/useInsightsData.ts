import { useLiveQuery } from 'dexie-react-hooks'
import { dayKey, dayKeyOffset } from '@tracker-engine/core'
import { trendChangePerWeek, weightTrend, type TrendPoint } from '@tracker-engine/body'
import * as repo from '@/data/repository'
import { dailyAverage, dayTotals, mgToGrams } from '@/lib/nutrition'
import { groupByWeek } from '@/lib/checkin'
import { filterExpenditure, kcalPerKg, windowEstimate, type ExpenditureWindow } from '@/lib/expenditure'
import { eatingOccasions, minutesIntoDay } from '@/lib/mealTiming'
import { entryName, foodIdsOf } from '@/features/shared/entryName'
import type { CheckIn, LogEntry, MacroTargets, Nutrients, Profile, Program } from '@/domain/types'

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
  /** Null when nothing logged that day recorded fibre — never zero (see lib/nutrition). */
  fiber: number | null
  targetKcal: number | null
  targetProtein: number | null
  occasions: number
  firstMinute: number | null
  lastMinute: number | null
}

export interface InsightsData {
  isLoading: boolean
  days: InsightsDay[]
  trend: TrendPoint[]
  ratePerWeek: number | null
  windows: ExpenditureWindow[]
  expenditureKcal: number | null
  expenditureSe: number | null
  checkIns: CheckIn[]
  program: Program | undefined
  profile: Profile | undefined
  targets: MacroTargets | null
  /** Per-day average over the window, for the nutrient adequacy chart. */
  averages: Nutrients
  loggedDayCount: number
  /** kcal eaten in each hour of the day, summed across the window. */
  kcalByHour: number[]
  /** How entries were logged, for the habit tab: search, barcode, describe, quick, … */
  sourceCounts: { source: string; count: number }[]
  /** Trend change across the window, in kg. Null with fewer than two weigh-ins. */
  weightChangeKg: number | null
  /** Share of days with a target that landed within 10% of it. Null when no day had one. */
  adherencePct: number | null
  /** The foods contributing the most calories over the window. */
  topFoods: { name: string; kcal: number; entries: number }[]
}

export function useInsightsData(windowDays: number): InsightsData {
  const from = dayKeyOffset(Date.now(), windowDays - 1)
  const today = dayKey(Date.now())

  const entries = useLiveQuery(() => repo.entriesBetween(from, today), [from, today], undefined)
  const weights = useLiveQuery(() => repo.weights(), [], undefined)
  const checkIns = useLiveQuery(() => repo.checkIns(), [], [])
  const program = useLiveQuery(() => repo.activeProgram(), [], undefined)
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)
  const targets = useLiveQuery(() => repo.currentTargets(), [], null)

  const byDay = new Map<string, LogEntry[]>()
  for (const entry of entries ?? []) {
    byDay.set(entry.day, [...(byDay.get(entry.day) ?? []), entry])
  }
  const dayKeys = [...byDay.keys()].sort()
  const targetsByDay = useLiveQuery(
    () => repo.targetsByDay(dayKeys),
    [dayKeys.join(',')],
    new Map<string, MacroTargets | null>(),
  )

  const days: InsightsDay[] = dayKeys.map((day) => {
    const rows = byDay.get(day) ?? []
    const occasions = eatingOccasions(rows)
    const target = targetsByDay?.get(day) ?? null
    const totals = dayTotals(rows)
    return {
      day,
      kcal: totals.kcal,
      protein: mgToGrams(totals.proteinMg),
      carbs: mgToGrams(totals.carbsMg),
      fat: mgToGrams(totals.fatMg),
      fiber: totals.fiberMg === null ? null : mgToGrams(totals.fiberMg),
      targetKcal: target?.kcal ?? null,
      targetProtein: target ? mgToGrams(target.proteinMg) : null,
      occasions: occasions.length,
      firstMinute: occasions.length > 0 ? minutesIntoDay(occasions[0]!.startAt) : null,
      lastMinute:
        occasions.length > 0 ? minutesIntoDay(occasions[occasions.length - 1]!.endAt) : null,
    }
  })

  // Smoothed once over the whole history, then sliced by week: smoothing inside a week re-seeds
  // the EWMA and destroys the signal, which understated expenditure by ~400 kcal/day.
  const trend = weightTrend(weights ?? [])
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

  const foods = useLiveQuery(
    () => repo.foodsByIds(foodIdsOf(entries ?? [])),
    [entries],
    undefined,
  )

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

  const scored = days.filter((day) => day.targetKcal !== null)
  const first = trend[0]
  const last = trend[trend.length - 1]

  return {
    isLoading: entries === undefined || weights === undefined,
    days,
    trend,
    ratePerWeek: trendChangePerWeek(trend),
    windows,
    expenditureKcal: expenditure?.kcal ?? null,
    expenditureSe: expenditure?.se ?? null,
    checkIns: checkIns ?? [],
    program,
    profile,
    targets,
    averages: dailyAverage(entries ?? []),
    loggedDayCount: dayKeys.length,
    kcalByHour,
    sourceCounts: [...sourceTally.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count),
    weightChangeKg: first && last && trend.length > 1 ? last.trendKg - first.trendKg : null,
    topFoods: [...contribution.entries()]
      .map(([name, value]) => ({ name, ...value }))
      .sort((a, b) => b.kcal - a.kcal)
      .slice(0, 12),
    adherencePct:
      scored.length === 0
        ? null
        : (scored.filter((day) => Math.abs(day.kcal - day.targetKcal!) <= day.targetKcal! * 0.1)
            .length /
            scored.length) *
          100,
  }
}
