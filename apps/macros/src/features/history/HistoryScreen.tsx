import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { dayKey, dayKeyOffset, formatRelativeDay, formatTimeOfDay } from '@tracker-engine/core'
import { Card, useToast } from '@tracker-engine/ui'
import { ChevronDown, Copy } from 'lucide-react'
import * as repo from '@/data/repository'
import { cn } from '@/lib/cn'
import { dailyAverage, dayTotals } from '@/lib/nutrition'
import { dayTiming, eatingOccasions, formatDuration } from '@/lib/mealTiming'
import { grams } from '@/features/shared/format'
import { MEAL_LABELS } from '@/features/shared/meals'
import type { Food, LogEntry, MacroTargets } from '@/domain/types'

const DAYS_SHOWN = 30

/**
 * Every logged day, openable.
 *
 * Each day is judged against the target that was in force *then*, not today's: a check-in for a
 * past week is an immutable record, so changing a goal now must not turn last month into a month
 * of failures. That was exactly what the old single-target line did.
 */
export function HistoryScreen() {
  const toast = useToast()
  const today = dayKey(Date.now())
  const from = dayKeyOffset(Date.now(), DAYS_SHOWN)
  const [open, setOpen] = useState<string | null>(null)

  const entries = useLiveQuery(() => repo.entriesBetween(from, today), [from, today], [])
  const foods = useLiveQuery(
    async () => repo.foodsByIds((entries ?? []).map((e) => e.foodId).filter(isString)),
    [entries],
    new Map<string, Food>(),
  )

  const byDay = new Map<string, LogEntry[]>()
  for (const entry of entries ?? []) {
    byDay.set(entry.day, [...(byDay.get(entry.day) ?? []), entry])
  }
  const days = [...byDay.keys()].sort((a, b) => b.localeCompare(a))
  const targets = useLiveQuery(() => repo.targetsByDay(days), [days.join(',')], new Map())

  const averages = dailyAverage(entries ?? [])

  return (
    <div className="space-y-3 px-3 py-3">
      <h1 className="px-1 text-[17px] font-semibold tracking-tight">History</h1>

      {days.length === 0 ? (
        <Card className="p-4 text-center text-[13.5px] text-ink-muted">Nothing logged yet.</Card>
      ) : (
        <Card className="p-4">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
            Last {DAYS_SHOWN} days
          </h2>
          <p className="tabular mt-1 text-[20px] font-bold leading-tight">
            {averages.kcal}
            <span className="text-[13px] font-medium text-ink-muted"> kcal/day average</span>
          </p>
          <p className="tabular mt-0.5 text-[12.5px] text-ink-muted">
            {grams(averages.proteinMg)}P {grams(averages.carbsMg)}C {grams(averages.fatMg)}F ·{' '}
            {days.length} day{days.length === 1 ? '' : 's'} logged
          </p>
        </Card>
      )}

      {days.map((day) => (
        <DayCard
          key={day}
          day={day}
          entries={byDay.get(day) ?? []}
          foods={foods ?? new Map()}
          target={targets?.get(day) ?? null}
          isOpen={open === day}
          onToggle={() => setOpen((current) => (current === day ? null : day))}
          onCopy={() => {
            void repo.copyDay(day, today).then((n) => toast.show(`Copied ${n} items`))
          }}
        />
      ))}
    </div>
  )
}

function DayCard({
  day,
  entries,
  foods,
  target,
  isOpen,
  onToggle,
  onCopy,
}: {
  day: string
  entries: LogEntry[]
  foods: ReadonlyMap<string, Food>
  target: MacroTargets | null
  isOpen: boolean
  onToggle: () => void
  onCopy: () => void
}) {
  const totals = dayTotals(entries)
  const delta = target ? totals.kcal - target.kcal : null
  const timing = dayTiming(entries)

  return (
    <Card className="p-0">
      <div className="flex items-center">
        <button
          onClick={onToggle}
          aria-expanded={isOpen}
          className="min-w-0 flex-1 px-4 py-3 text-left active:bg-sunken"
        >
          <div className="flex items-baseline gap-2">
            <h2 className="flex-1 truncate text-[15px] font-semibold tracking-tight">
              {formatRelativeDay(Date.parse(`${day}T12:00:00`))}
            </h2>
            <span className="tabular text-[14px] font-semibold">{totals.kcal}</span>
            <ChevronDown
              size={16}
              className={cn('shrink-0 text-ink-muted transition-transform', isOpen && 'rotate-180')}
            />
          </div>
          <p className="tabular mt-0.5 text-[12.5px] text-ink-muted">
            {grams(totals.proteinMg)}P {grams(totals.carbsMg)}C {grams(totals.fatMg)}F
            {delta !== null &&
              ` · ${delta === 0 ? 'on target' : `${Math.abs(delta)} kcal ${delta > 0 ? 'over' : 'under'}`}`}
            {timing.spanMinutes !== null &&
              ` · ${timing.occasions} meals over ${formatDuration(timing.spanMinutes)}`}
          </p>
        </button>
        <button
          onClick={onCopy}
          aria-label={`Copy ${day} to today`}
          className="mr-2 flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-muted active:bg-sunken"
        >
          <Copy size={16} />
        </button>
      </div>

      {isOpen && (
        <div className="border-t border-line">
          {target === null && (
            <p className="px-4 pt-2 text-[12px] text-ink-muted">
              No target was in force yet on this day.
            </p>
          )}
          {eatingOccasions(entries).map((occasion) => (
            <div key={occasion.startAt}>
              <div className="flex items-baseline justify-between px-4 pb-1 pt-2.5">
                <span className="text-[12.5px] font-semibold">
                  {formatTimeOfDay(occasion.startAt)}
                  <span className="font-normal text-ink-muted">
                    {' '}
                    · {MEAL_LABELS[occasion.entries[0]!.meal]}
                  </span>
                </span>
                <span className="tabular text-[12.5px] text-ink-muted">
                  {occasion.nutrients.kcal} kcal
                </span>
              </div>
              <ul className="divide-y divide-line">
                {occasion.entries.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-2 px-4 py-1.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px]">
                        {nameOf(entry, foods)}
                      </span>
                      <span className="tabular block text-[11.5px] text-ink-muted">
                        {entry.grams > 0 && `${Math.round(entry.grams)}g · `}
                        {grams(entry.nutrients.proteinMg)}P {grams(entry.nutrients.carbsMg)}C{' '}
                        {grams(entry.nutrients.fatMg)}F
                      </span>
                    </span>
                    <span className="tabular text-[13px]">{entry.nutrients.kcal}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function nameOf(entry: LogEntry, foods: ReadonlyMap<string, Food>): string {
  if (entry.foodId) return foods.get(entry.foodId)?.description ?? (entry.note || 'Food')
  return entry.note || 'Quick add'
}

const isString = (value: string | null): value is string => value !== null
