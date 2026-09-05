import { useLiveQuery } from 'dexie-react-hooks'
import { DAY_MS, dayKey, formatRelativeDay } from '@tracker-engine/core'
import { Card, useToast } from '@tracker-engine/ui'
import { Copy } from 'lucide-react'
import * as repo from '@/data/repository'
import { dayTotals } from '@/lib/nutrition'
import { grams } from '@/features/shared/format'

const DAYS_SHOWN = 30

export function HistoryScreen() {
  const toast = useToast()
  const today = dayKey(Date.now())
  const from = dayKey(Date.now() - DAYS_SHOWN * DAY_MS)

  const entries = useLiveQuery(() => repo.entriesBetween(from, today), [from, today], [])
  const targets = useLiveQuery(() => repo.currentTargets(), [], null)

  const byDay = new Map<string, typeof entries>()
  for (const entry of entries ?? []) {
    byDay.set(entry.day, [...(byDay.get(entry.day) ?? []), entry])
  }
  const days = [...byDay.keys()].sort((a, b) => b.localeCompare(a))

  return (
    <div className="space-y-3 px-3 py-3">
      <h1 className="px-1 text-[17px] font-semibold tracking-tight">History</h1>

      {days.length === 0 && (
        <Card className="p-4 text-center text-[13.5px] text-ink-muted">
          Nothing logged yet.
        </Card>
      )}

      {days.map((day) => {
        const totals = dayTotals(byDay.get(day) ?? [])
        const delta = targets ? totals.kcal - targets.kcal : null
        return (
          <Card key={day} className="p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[15px] font-semibold tracking-tight">
                {formatRelativeDay(Date.parse(`${day}T12:00:00`))}
              </h2>
              <button
                onClick={() => {
                  void repo.copyDay(day, today).then((n) => toast.show(`Copied ${n} items`))
                }}
                aria-label="Copy to today"
                className="flex size-8 items-center justify-center rounded-lg text-ink-muted active:bg-sunken"
              >
                <Copy size={16} />
              </button>
            </div>
            <p className="tabular mt-1 text-[13px] text-ink-secondary">
              {totals.kcal} kcal · {grams(totals.proteinMg)}P {grams(totals.carbsMg)}C{' '}
              {grams(totals.fatMg)}F
            </p>
            {delta !== null && (
              <p className="tabular mt-0.5 text-[12.5px] text-ink-muted">
                {delta === 0
                  ? 'on target'
                  : `${Math.abs(delta)} kcal ${delta > 0 ? 'over' : 'under'} target`}
              </p>
            )}
          </Card>
        )
      })}
    </div>
  )
}
