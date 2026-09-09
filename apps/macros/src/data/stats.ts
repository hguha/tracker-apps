import { dayKey, dayStreaks } from '@tracker-engine/core'
import * as repo from '@/data/repository'
import { dayTotals } from '@/lib/nutrition'
import { groupByWeek } from '@/lib/checkin'
import { nutrientTargets } from '@/lib/micronutrients'
import type { LogEntry } from '@/domain/types'

/**
 * Lifetime counts for the badge catalog.
 *
 * Every "did I hit my target" question is answered against the target that was in force *that
 * day* (repo.targetsByDay), not today's. Otherwise changing a goal would retroactively award or
 * revoke badges, which is exactly the bug the History screen had.
 */

export interface NutritionStatsShape {
  daysLogged: number
  currentDayStreak: number
  bestDayStreak: number
  entriesLogged: number
  distinctFoods: number
  weighInDays: number
  bestWeighInStreak: number
  daysProteinMet: number
  daysWithinTarget: number
  daysFiberMet: number
  checkInsEarned: number
  savedMeals: number
  barcodesScanned: number
  describedMeals: number
  completeWeeks: number
}

/** Within this fraction of the calorie target counts as on plan. */
const TARGET_TOLERANCE = 0.1

export async function nutritionStats(): Promise<NutritionStatsShape> {
  const entries = await repo.allEntries()
  const weights = await repo.weights()
  const checkIns = await repo.checkIns()
  const templates = await repo.mealTemplates()
  const fiberReference =
    nutrientTargets((await repo.getProfile()).sex).find((target) => target.key === 'fiberMg')
      ?.reference ?? 28_000

  const byDay = new Map<string, LogEntry[]>()
  for (const entry of entries) {
    byDay.set(entry.day, [...(byDay.get(entry.day) ?? []), entry])
  }
  const days = [...byDay.keys()].sort()
  const targets = await repo.targetsByDay(days)

  let daysProteinMet = 0
  let daysWithinTarget = 0
  let daysFiberMet = 0
  for (const day of days) {
    const totals = dayTotals(byDay.get(day) ?? [])
    const target = targets.get(day)
    if (target) {
      if (totals.proteinMg >= target.proteinMg) daysProteinMet += 1
      if (Math.abs(totals.kcal - target.kcal) <= target.kcal * TARGET_TOLERANCE) {
        daysWithinTarget += 1
      }
    }
    if (totals.fiberMg !== null && totals.fiberMg >= fiberReference) daysFiberMet += 1
  }

  const logStreaks = dayStreaks(days)
  const weighInStreaks = dayStreaks(weights.map((row) => row.day))
  // The same bar the expenditure estimate uses, so a badge can't claim a week the algorithm
  // rejected.
  const completeWeeks = [...groupByWeek(days.map((day) => ({ day })), (d) => d.day).values()].filter(
    (week) => week.length >= 4,
  ).length

  return {
    daysLogged: days.length,
    currentDayStreak: logStreaks.current,
    bestDayStreak: logStreaks.best,
    entriesLogged: entries.length,
    distinctFoods: new Set(entries.map((entry) => entry.foodId).filter(Boolean)).size,
    weighInDays: new Set(weights.map((row) => row.day)).size,
    bestWeighInStreak: weighInStreaks.best,
    daysProteinMet,
    daysWithinTarget,
    daysFiberMet,
    checkInsEarned: checkIns.length,
    savedMeals: templates.length,
    barcodesScanned: entries.filter((entry) => entry.source === 'barcode').length,
    describedMeals: countDescribedMeals(entries),
    completeWeeks,
  }
}

/** Described meals arrive as several rows at one instant, so count the sittings, not the rows. */
function countDescribedMeals(entries: readonly LogEntry[]): number {
  const sittings = new Set(
    entries
      .filter((entry) => entry.source === 'describe')
      .map((entry) => `${dayKey(entry.eatenAt)}|${Math.round(entry.eatenAt / 60_000)}`),
  )
  return sittings.size
}
