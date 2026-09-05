import { useLiveQuery } from 'dexie-react-hooks'
import { dayKey, formatDayHeading } from '@tracker-engine/core'
import { Card, ProgressRing } from '@tracker-engine/ui'
import { Sparkles, Trash2 } from 'lucide-react'
import * as repo from '@/data/repository'
import { dayTotals, remaining } from '@/lib/nutrition'
import { MEAL_SLOTS, type LogEntry, type MealSlot } from '@/domain/types'
import { grams, MACRO_META } from '@/features/shared/format'
import { CheckInCard } from '@/features/checkin/CheckInCard'
import { MacroBar } from './MacroBar'
import { WeighInCard } from './WeighInCard'

const MEAL_LABELS: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks',
}

export function TodayScreen({
  onLog,
  onOpenCoach,
}: {
  onLog: (meal: MealSlot) => void
  onOpenCoach: () => void
}) {
  const today = dayKey(Date.now())
  const entries = useLiveQuery(() => repo.entriesForDay(today), [today], [])
  const targets = useLiveQuery(() => repo.currentTargets(), [], null)

  const totals = dayTotals(entries ?? [])
  const left = targets ? remaining(totals, targets) : null

  return (
    <div className="space-y-3 px-3 py-3">
      <h1 className="px-1 text-[17px] font-semibold tracking-tight">
        {formatDayHeading(Date.now())}
      </h1>

      <Card className="p-4">
        <div className="flex items-center gap-4">
          <ProgressRing value={totals.kcal} max={targets?.kcal ?? 0} size={92}>
            <div className="text-center">
              <div className="tabular text-[20px] font-bold leading-none">{totals.kcal}</div>
              <div className="text-[10.5px] text-ink-muted">kcal</div>
            </div>
          </ProgressRing>

          <div className="flex-1 space-y-2.5">
            {MACRO_META.map((macro) => (
              <MacroBar
                key={macro.key}
                label={macro.label}
                eatenMg={totals[macro.key]}
                targetMg={targets?.[macro.key] ?? 0}
                barClassName={macro.bar}
              />
            ))}
          </div>
        </div>

        {left ? (
          <p className="mt-3 text-[13px] text-ink-secondary">
            {left.kcal >= 0
              ? `${left.kcal} kcal and ${grams(Math.max(0, left.proteinMg))} protein left today.`
              : `${Math.abs(left.kcal)} kcal over target.`}
          </p>
        ) : (
          <p className="mt-3 text-[13px] text-ink-muted">
            No target yet — log a few days and a weight, and the app works one out.
          </p>
        )}
      </Card>

      <CheckInCard />

      <button
        onClick={onOpenCoach}
        className="flex w-full items-center gap-2 rounded-2xl bg-surface px-4 py-3 text-left ring-1 ring-line active:bg-sunken"
      >
        <Sparkles size={18} className="shrink-0 text-accent" />
        <span className="flex-1 text-[14px] font-medium">Ask the coach</span>
        <span className="text-[12.5px] text-ink-muted">about your numbers</span>
      </button>

      <WeighInCard />

      {MEAL_SLOTS.map((meal) => (
        <MealSection
          key={meal}
          meal={meal}
          entries={(entries ?? []).filter((e) => e.meal === meal)}
          onAdd={() => onLog(meal)}
        />
      ))}
    </div>
  )
}

function MealSection({
  meal,
  entries,
  onAdd,
}: {
  meal: MealSlot
  entries: LogEntry[]
  onAdd: () => void
}) {
  const totals = dayTotals(entries)
  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold tracking-tight">{MEAL_LABELS[meal]}</h2>
        <span className="tabular text-[13px] text-ink-muted">{totals.kcal} kcal</span>
      </div>

      {entries.length > 0 && (
        <ul className="mt-2 divide-y divide-line">
          {entries
            .sort((a, b) => a.sortIndex - b.sortIndex)
            .map((entry) => (
              <EntryRow key={entry.id} entry={entry} />
            ))}
        </ul>
      )}

      <button
        onClick={onAdd}
        className="mt-2 w-full rounded-xl border border-dashed border-line-strong py-2 text-[13.5px] font-semibold text-accent active:opacity-60"
      >
        + Add food
      </button>
    </Card>
  )
}

function EntryRow({ entry }: { entry: LogEntry }) {
  const food = useLiveQuery(
    () => (entry.foodId ? repo.getFood(entry.foodId) : Promise.resolve(undefined)),
    [entry.foodId],
  )
  const name = food?.description ?? entry.note ?? 'Quick add'

  return (
    <li className="flex items-center gap-2 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px]">{name}</div>
        <div className="tabular text-[12px] text-ink-muted">
          {entry.grams > 0 && `${Math.round(entry.grams)}g · `}
          {grams(entry.nutrients.proteinMg)}P {grams(entry.nutrients.carbsMg)}C{' '}
          {grams(entry.nutrients.fatMg)}F
          {entry.estimate && <span className="text-confidence-medium"> · estimate</span>}
        </div>
      </div>
      <span className="tabular text-[14px] font-semibold">{entry.nutrients.kcal}</span>
      <button
        onClick={() => void repo.deleteEntry(entry.id)}
        aria-label="Remove"
        className="flex size-8 items-center justify-center rounded-lg text-ink-muted active:bg-sunken"
      >
        <Trash2 size={16} />
      </button>
    </li>
  )
}
