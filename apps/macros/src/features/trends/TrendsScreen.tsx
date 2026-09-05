import { useLiveQuery } from 'dexie-react-hooks'
import { DAY_MS, dayKey, weekKey } from '@tracker-engine/core'
import { trendChangePerWeek, weightTrend } from '@tracker-engine/body'
import { Card } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { filterExpenditure, kcalPerKg, windowEstimate } from '@/lib/expenditure'

const WINDOW_DAYS = 56

/**
 * The numbers behind the target. Expenditure is shown with its error bar and never on its
 * own, because a point estimate invites the user to treat a measurement as a fact.
 */
export function TrendsScreen() {
  const from = dayKey(Date.now() - WINDOW_DAYS * DAY_MS)
  const today = dayKey(Date.now())

  const weights = useLiveQuery(() => repo.weights(), [], [])
  const entries = useLiveQuery(() => repo.entriesBetween(from, today), [from, today], [])
  const program = useLiveQuery(() => repo.activeProgram(), [], undefined)

  const trend = weightTrend(weights ?? [])
  const ratePerWeek = trendChangePerWeek(trend)

  // Group intake and weigh-ins into ISO weeks, then let the filter fold them.
  const intakeByDay = new Map<string, number>()
  for (const entry of entries ?? []) {
    intakeByDay.set(entry.day, (intakeByDay.get(entry.day) ?? 0) + entry.nutrients.kcal)
  }

  const weeks = new Map<string, { intake: { day: string; kcal: number }[]; weights: typeof weights }>()
  for (const [day, kcal] of intakeByDay) {
    const key = weekKey(Date.parse(`${day}T12:00:00`), 1)
    const bucket = weeks.get(key) ?? { intake: [], weights: [] }
    bucket.intake.push({ day, kcal })
    weeks.set(key, bucket)
  }
  for (const row of weights ?? []) {
    const key = weekKey(Date.parse(`${row.day}T12:00:00`), 1)
    const bucket = weeks.get(key) ?? { intake: [], weights: [] }
    bucket.weights = [...(bucket.weights ?? []), row]
    weeks.set(key, bucket)
  }

  const energyPerKg = kcalPerKg(program?.goal ?? 'maintain', program?.ratePctPerWeek ?? 0)
  const windows = [...weeks.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, bucket]) => windowEstimate(week, bucket.intake, bucket.weights ?? [], energyPerKg))
    .filter((w): w is NonNullable<typeof w> => w !== null)

  const expenditure = filterExpenditure(windows, null)
  const latest = trend[trend.length - 1]

  return (
    <div className="space-y-3 px-3 py-3">
      <h1 className="px-1 text-[17px] font-semibold tracking-tight">Trends</h1>

      <Card className="p-4">
        <h2 className="text-[15px] font-semibold tracking-tight">Expenditure</h2>
        {expenditure ? (
          <>
            <p className="tabular mt-1 text-[24px] font-bold leading-tight">
              {expenditure.kcal}
              <span className="text-[14px] font-medium text-ink-muted"> ± {expenditure.se} kcal/day</span>
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
      </Card>

      <CheckInHistory />

      <Card className="p-4">
        <h2 className="text-[15px] font-semibold tracking-tight">Weight</h2>
        {latest ? (
          <>
            <p className="tabular mt-1 text-[24px] font-bold leading-tight">
              {latest.trendKg.toFixed(1)}
              <span className="text-[14px] font-medium text-ink-muted"> kg trend</span>
            </p>
            <p className="tabular mt-1 text-[12.5px] text-ink-muted">
              Last weighed {latest.kg.toFixed(1)} kg
              {ratePerWeek !== null && ` · ${ratePerWeek >= 0 ? '+' : ''}${ratePerWeek.toFixed(2)} kg/week`}
            </p>
          </>
        ) : (
          <p className="mt-1 text-[13px] text-ink-muted">No weigh-ins yet.</p>
        )}
      </Card>
    </div>
  )
}

/** Every past recalculation. The adaptation is the product, so it should be inspectable. */
function CheckInHistory() {
  const history = useLiveQuery(() => repo.checkIns(), [], [])
  const weeks = (history ?? [])
    .filter((c) => c.status !== 'declined')
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart))
    .slice(0, 8)

  if (weeks.length === 0) return null

  return (
    <Card className="p-4">
      <h2 className="text-[15px] font-semibold tracking-tight">Check-ins</h2>
      <ul className="mt-2 divide-y divide-line">
        {weeks.map((week) => (
          <li key={week.id} className="flex items-baseline justify-between py-2">
            <div>
              <div className="tabular text-[13.5px]">{week.weekStart}</div>
              <div className="tabular text-[12px] text-ink-muted">
                {week.daysLogged}/7 days · {week.trendChangeKgPerWeek >= 0 ? '+' : ''}
                {week.trendChangeKgPerWeek.toFixed(2)} kg/wk
              </div>
            </div>
            <div className="text-right">
              <div className="tabular text-[14px] font-semibold">{week.targets.kcal}</div>
              <div className="tabular text-[11.5px] text-ink-muted">
                exp {week.expenditureKcal} ± {week.expenditureSe}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}
