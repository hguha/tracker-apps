import { dayKey, dayStreaks } from '@tracker-engine/core'
import { db } from '@/db'
import { takeEntryChanges } from '@/db/entryChanges'
import * as repo from '@/data/repository'
import { dayTotals } from '@/lib/nutrition'
import { groupByWeek } from '@/lib/checkin'
import { nutrientTargets } from '@/lib/micronutrients'
import type { LogEntry, NutritionStats } from '@/domain/types'

/**
 * Lifetime counts for the badge catalog.
 *
 * Every "did I hit my target" question is answered against the target that was in force *that
 * day* (repo.targetsByDay), not today's. Otherwise changing a goal would retroactively award or
 * revoke badges, which is exactly the bug the History screen had.
 */

/** Within this fraction of the calorie target counts as on plan. */
const TARGET_TOLERANCE = 0.1

interface DaySummary {
  kcal: number
  proteinMg: number
  fiberMg: number | null
  entries: number
  barcodes: number
  foodIds: string[]
  sittings: string[]
}

interface SummaryCache {
  owner: string
  count: number
  stamp: number
  days: Map<string, DaySummary>
}

let cache: SummaryCache | null = null

function summarise(rows: readonly LogEntry[]): DaySummary {
  const totals = dayTotals(rows)
  return {
    kcal: totals.kcal,
    proteinMg: totals.proteinMg,
    fiberMg: totals.fiberMg,
    entries: rows.length,
    barcodes: rows.filter((entry) => entry.source === 'barcode').length,
    foodIds: [...new Set(rows.flatMap((entry) => (entry.foodId ? [entry.foodId] : [])))],
    sittings: [
      ...new Set(
        rows
          .filter((entry) => entry.source === 'describe')
          .map((entry) => `${dayKey(entry.eatenAt)}|${Math.round(entry.eatenAt / 60_000)}`),
      ),
    ],
  }
}

async function entrySignals(): Promise<{ count: number; stamp: number }> {
  const [count, latest] = await Promise.all([
    db.logEntries.count(),
    db.logEntries.orderBy('updatedAt').last(),
  ])
  return { count, stamp: latest?.updatedAt ?? 0 }
}

async function rebuild(): Promise<Map<string, DaySummary>> {
  const byDay = new Map<string, LogEntry[]>()
  for (const entry of await repo.allEntries()) {
    const rows = byDay.get(entry.day)
    if (rows) rows.push(entry)
    else byDay.set(entry.day, [entry])
  }
  const days = new Map<string, DaySummary>()
  for (const [day, rows] of byDay) days.set(day, summarise(rows))
  return days
}

async function daySummaries(owner: string): Promise<Map<string, DaySummary>> {
  const changes = takeEntryChanges()
  const signals = await entrySignals()
  const unexplained =
    cache !== null &&
    changes.days.size === 0 &&
    (cache.count !== signals.count || cache.stamp !== signals.stamp)

  if (cache === null || cache.owner !== owner || changes.all || unexplained) {
    const days = await rebuild()
    cache = { owner, ...signals, days }
    return days
  }

  for (const day of changes.days) {
    const rows = await repo.entriesForDay(day)
    if (rows.length === 0) cache.days.delete(day)
    else cache.days.set(day, summarise(rows))
  }
  cache.count = signals.count
  cache.stamp = signals.stamp
  return cache.days
}

export function resetNutritionStatsCache(): void {
  cache = null
}

export async function nutritionStats(): Promise<NutritionStats> {
  const profile = await repo.getProfile()
  const [summaries, weights, checkIns, recipes] = await Promise.all([
    daySummaries(profile.id),
    repo.weights(),
    repo.checkIns(),
    repo.recipes(),
  ])
  const fiberReference =
    nutrientTargets(profile.sex).find((target) => target.key === 'fiberMg')?.reference ?? 28_000

  const days = [...summaries.keys()].sort()
  const targets = await repo.targetsByDay(days)

  let daysProteinMet = 0
  let daysWithinTarget = 0
  let daysFiberMet = 0
  let entriesLogged = 0
  let barcodesScanned = 0
  const foods = new Set<string>()
  const sittings = new Set<string>()
  for (const day of days) {
    const summary = summaries.get(day)!
    entriesLogged += summary.entries
    barcodesScanned += summary.barcodes
    summary.foodIds.forEach((id) => foods.add(id))
    summary.sittings.forEach((key) => sittings.add(key))
    const target = targets.get(day)
    if (target) {
      if (summary.proteinMg >= target.proteinMg) daysProteinMet += 1
      if (Math.abs(summary.kcal - target.kcal) <= target.kcal * TARGET_TOLERANCE) {
        daysWithinTarget += 1
      }
    }
    if (summary.fiberMg !== null && summary.fiberMg >= fiberReference) daysFiberMet += 1
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
    entriesLogged,
    distinctFoods: foods.size,
    weighInDays: new Set(weights.map((row) => row.day)).size,
    bestWeighInStreak: weighInStreaks.best,
    daysProteinMet,
    daysWithinTarget,
    daysFiberMet,
    checkInsEarned: checkIns.length,
    recipesSaved: recipes.length,
    barcodesScanned,
    describedMeals: sittings.size,
    completeWeeks,
  }
}
