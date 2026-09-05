import { useLiveQuery } from 'dexie-react-hooks'
import { DAY_MS, dayKey } from '@tracker-engine/core'
import { trendChangePerWeek, weightTrend } from '@tracker-engine/body'
import { Card } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { mgToGrams } from '@/lib/nutrition'
import { filterExpenditure, kcalPerKg, windowEstimate } from '@/lib/expenditure'
import { groupByWeek } from '@/lib/checkin'
import { IntakeChart } from './IntakeChart'
import { WeightChart } from './WeightChart'
import { MacroSplitChart } from './MacroSplitChart'
import { CheckInHistory } from './CheckInHistory'

const WINDOW_DAYS = 56

export function InsightsScreen() {
  const from = dayKey(Date.now() - WINDOW_DAYS * DAY_MS)
  const today = dayKey(Date.now())

  const weights = useLiveQuery(() => repo.weights(), [], [])
  const entries = useLiveQuery(() => repo.entriesBetween(from, today), [from, today], [])
  const program = useLiveQuery(() => repo.activeProgram(), [], undefined)
  const targets = useLiveQuery(() => repo.currentTargets(), [], null)

  const trend = weightTrend(weights ?? [])
  const ratePerWeek = trendChangePerWeek(trend)

  // Per-day intake and macro grams, from the canonical rows.
  const byDay = new Map<string, { kcal: number; protein: number; carbs: number; fat: number }>()
  for (const entry of entries ?? []) {
    const day = byDay.get(entry.day) ?? { kcal: 0, protein: 0, carbs: 0, fat: 0 }
    day.kcal += entry.nutrients.kcal
    day.protein += mgToGrams(entry.nutrients.proteinMg)
    day.carbs += mgToGrams(entry.nutrients.carbsMg)
    day.fat += mgToGrams(entry.nutrients.fatMg)
    byDay.set(entry.day, day)
  }
  const days = [...byDay.entries()]
    .map(([day, totals]) => ({ day, ...totals }))
    .sort((a, b) => a.day.localeCompare(b.day))

  // The same week grouping the check-in uses, so the two can't disagree about boundaries.
  const energyPerKg = kcalPerKg(program?.goal ?? 'maintain', program?.ratePctPerWeek ?? 0)
  const intakeWeeks = groupByWeek(
    days.map((d) => ({ day: d.day, kcal: d.kcal })),
    (d) => d.day,
  )
  const weightWeeks = groupByWeek(weights ?? [], (w) => w.day)
  const windows = [...new Set([...intakeWeeks.keys(), ...weightWeeks.keys()])]
    .sort()
    .map((week) =>
      windowEstimate(week, intakeWeeks.get(week) ?? [], weightWeeks.get(week) ?? [], energyPerKg),
    )
    .filter((w): w is NonNullable<typeof w> => w !== null)
  const expenditure = filterExpenditure(windows, null)

  const latest = trend[trend.length - 1]

  return (
    <div className="space-y-3 px-3 py-3">
      <h1 className="px-1 text-[17px] font-semibold tracking-tight">Insights</h1>

      <Card className="p-4">
        <h2 className="text-[15px] font-semibold tracking-tight">Expenditure</h2>
        {expenditure ? (
          <>
            <p className="tabular mt-1 text-[26px] font-bold leading-tight">
              {expenditure.kcal}
              <span className="text-[14px] font-medium text-ink-muted">
                {' '}
                ± {expenditure.se} kcal/day
              </span>
            </p>
            <p className="mt-1 text-[12.5px] text-ink-muted">
              Measured from {windows.length} week{windows.length === 1 ? '' : 's'} of weigh-ins and
              logs — not a formula, and not a wearable estimate.
            </p>
          </>
        ) : (
          <p className="mt-1 text-[13px] text-ink-muted">
            Needs a week with at least four days logged and three weigh-ins.
          </p>
        )}
        {latest && (
          <p className="tabular mt-2 border-t border-line pt-2 text-[12.5px] text-ink-muted">
            Weight trend {latest.trendKg.toFixed(1)} kg
            {ratePerWeek !== null &&
              ` · ${ratePerWeek >= 0 ? '+' : ''}${ratePerWeek.toFixed(2)} kg/week`}
          </p>
        )}
      </Card>

      <IntakeChart days={days} targetKcal={targets?.kcal ?? null} />
      <WeightChart trend={trend} />
      <MacroSplitChart days={days} />
      <CheckInHistory />
    </div>
  )
}
