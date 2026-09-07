import { formatTimeOfDay } from '@tracker-engine/core'
import { Card } from '@tracker-engine/ui'
import { Bookmark, Plus } from 'lucide-react'
import { dayTiming, eatingOccasions, formatDuration } from '@/lib/mealTiming'
import { grams } from '@/features/shared/format'
import { MEAL_LABELS } from '@/features/shared/meals'
import type { Food, LogEntry } from '@/domain/types'

/**
 * What was eaten, in the order it was eaten.
 *
 * Grouped by eating occasion rather than by breakfast/lunch/dinner: five small meals and one
 * large one are genuinely different days, and a screen with four fixed meal boxes can't show
 * that difference — it also can't show a 2pm snack as anything other than a filing decision.
 * The meal label rides along on each occasion instead, where it's a description rather than
 * the structure.
 */
export function Timeline({
  entries,
  foods,
  onAdd,
  onEdit,
  onSaveMeal,
}: {
  entries: readonly LogEntry[]
  foods: ReadonlyMap<string, Food>
  onAdd: () => void
  onEdit: (entry: LogEntry) => void
  onSaveMeal: (entries: LogEntry[]) => void
}) {
  const occasions = eatingOccasions(entries)
  const timing = dayTiming(entries)

  return (
    <Card className="p-0">
      <div className="flex items-baseline justify-between px-4 pb-1 pt-3">
        <h2 className="text-[15px] font-semibold tracking-tight">Today&rsquo;s food</h2>
        {timing.firstAt !== null && (
          <span className="tabular text-[12px] text-ink-muted">
            {formatTimeOfDay(timing.firstAt)}–{formatTimeOfDay(timing.lastAt ?? timing.firstAt)}
            {timing.spanMinutes !== null && ` · ${formatDuration(timing.spanMinutes)}`}
          </span>
        )}
      </div>

      {occasions.length === 0 ? (
        <p className="px-4 py-5 text-center text-[13.5px] text-ink-muted">
          Nothing logged yet today.
        </p>
      ) : (
        <>
          <p className="px-4 pb-2 text-[12px] text-ink-muted">
            {occasions.length} eating occasion{occasions.length === 1 ? '' : 's'}
            {timing.largestShare !== null &&
              ` · biggest was ${Math.round(timing.largestShare * 100)}% of the day`}
          </p>
          <ul>
            {occasions.map((occasion) => (
              <li key={occasion.startAt} className="border-t border-line">
                <div className="flex items-baseline justify-between px-4 pb-1 pt-2.5">
                  <span className="text-[13px] font-semibold">
                    {formatTimeOfDay(occasion.startAt)}
                    <span className="font-normal text-ink-muted">
                      {' '}
                      · {MEAL_LABELS[occasion.entries[0]!.meal]}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular text-[13px] font-semibold">
                      {occasion.nutrients.kcal} kcal
                    </span>
                    <button
                      onClick={() => onSaveMeal(occasion.entries)}
                      aria-label="Save as a meal"
                      className="flex size-7 items-center justify-center rounded-lg text-ink-muted active:bg-sunken"
                    >
                      <Bookmark size={15} />
                    </button>
                  </span>
                </div>
                <ul className="divide-y divide-line">
                  {occasion.entries.map((entry) => (
                    <li key={entry.id}>
                      <button
                        onClick={() => onEdit(entry)}
                        className="flex w-full items-center gap-2 px-4 py-2 text-left active:bg-sunken"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px]">
                            {nameOf(entry, foods)}
                          </span>
                          <span className="tabular block text-[12px] text-ink-muted">
                            {entry.grams > 0 && `${Math.round(entry.grams)}g · `}
                            {grams(entry.nutrients.proteinMg)}P {grams(entry.nutrients.carbsMg)}C{' '}
                            {grams(entry.nutrients.fatMg)}F
                            {entry.estimate && (
                              <span className="text-confidence-medium"> · estimate</span>
                            )}
                          </span>
                        </span>
                        <span className="tabular text-[14px] font-semibold">
                          {entry.nutrients.kcal}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}

      <button
        onClick={onAdd}
        className="flex w-full items-center justify-center gap-1.5 border-t border-line py-3 text-[13.5px] font-semibold text-accent active:bg-sunken"
      >
        <Plus size={16} />
        Add food
      </button>
    </Card>
  )
}

function nameOf(entry: LogEntry, foods: ReadonlyMap<string, Food>): string {
  if (entry.foodId) return foods.get(entry.foodId)?.description ?? (entry.note || 'Food')
  return entry.note || 'Quick add'
}
