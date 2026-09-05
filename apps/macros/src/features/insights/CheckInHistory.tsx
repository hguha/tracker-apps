import { useLiveQuery } from 'dexie-react-hooks'
import { Card } from '@tracker-engine/ui'
import * as repo from '@/data/repository'

/** Every past recalculation. The adaptation is the product, so it should be inspectable
 *  rather than magic. Declined weeks are hidden — they didn't change anything. */
export function CheckInHistory() {
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
          <li key={week.id} className="flex items-baseline justify-between gap-3 py-2">
            <div className="min-w-0">
              <div className="tabular text-[13.5px]">{week.weekStart}</div>
              <div className="tabular text-[12px] text-ink-muted">
                {week.daysLogged}/7 days · {week.trendChangeKgPerWeek >= 0 ? '+' : ''}
                {week.trendChangeKgPerWeek.toFixed(2)} kg/wk
              </div>
            </div>
            <div className="shrink-0 text-right">
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
