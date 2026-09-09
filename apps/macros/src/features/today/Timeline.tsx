import { formatTimeOfDay } from '@tracker-engine/core'
import { Card } from '@tracker-engine/ui'
import { ChevronRight, Plus } from 'lucide-react'
import { dayTiming, eatingOccasions, formatDuration } from '@/lib/mealTiming'
import { MEAL_LABELS } from '@/features/shared/meals'
import { entryName } from '@/features/shared/entryName'
import { MacroSplitBar } from '@/features/shared/MacroSplitBar'
import { VENUE_ICONS } from '@/features/shared/venue'
import type { Food, LogEntry } from '@/domain/types'

/**
 * The day's meals, at a glance, opening into the day editor.
 *
 * This used to be the whole log inline: every item, on its own line, in small grey text, on the
 * screen the app opens to. That is a lot of reading to answer the question Today is actually for —
 * "how am I doing, and what have I eaten" — and editing anything meant hunting a row in it.
 *
 * So it summarises by *sitting* rather than by item: a time, a meal, its calories, and the shape of
 * its macros as one bar. Six meals is six lines instead of twenty, and the detail is one tap away on
 * a screen built for it.
 */
export function Timeline({
  entries,
  foods,
  onAdd,
  onOpen,
}: {
  entries: readonly LogEntry[]
  /** Held for the item names in each sitting's one-line summary. */
  foods: ReadonlyMap<string, Food>
  onAdd: () => void
  onOpen: () => void
}) {
  const occasions = eatingOccasions(entries)
  const timing = dayTiming(entries)

  return (
    <Card className="p-0">
      <button
        onClick={onOpen}
        className="flex w-full items-center gap-2 px-4 py-3 text-left active:bg-sunken"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold tracking-tight">Today&rsquo;s food</span>
          <span className="tabular block truncate text-[12px] text-ink-muted">
            {entries.length === 0
              ? 'Nothing yet'
              : `${entries.length} item${entries.length === 1 ? '' : 's'}` +
                (occasions.length > 1 ? ` in ${occasions.length} meals` : '') +
                (timing.spanMinutes !== null
                  ? ` · over ${formatDuration(timing.spanMinutes)}`
                  : '')}
          </span>
        </span>
        <ChevronRight size={17} className="shrink-0 text-ink-muted" />
      </button>

      {occasions.length > 0 && (
        <ul className="divide-y divide-line border-t border-line">
          {occasions.map((occasion) => {
            const venue = occasion.entries.find((entry) => entry.venue !== null)?.venue ?? null
            const Icon = venue === null ? null : VENUE_ICONS[venue]
            return (
              <li key={occasion.startAt}>
                <button
                  onClick={onOpen}
                  className="w-full px-4 py-2 text-left active:bg-sunken"
                >
                  <span className="flex items-baseline gap-2">
                    <span className="tabular shrink-0 text-[12px] text-ink-muted">
                      {formatTimeOfDay(occasion.startAt)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13.5px]">
                      {summarise(occasion.entries, foods)}
                    </span>
                    {Icon && <Icon size={11} className="shrink-0 text-ink-muted" />}
                    <span className="tabular shrink-0 text-[13px] font-medium">
                      {occasion.nutrients.kcal}
                    </span>
                  </span>
                  <MacroSplitBar nutrients={occasion.nutrients} className="mt-1.5" />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <button
        onClick={onAdd}
        className="flex w-full items-center justify-center gap-1.5 border-t border-line py-2.5 text-[13.5px] font-semibold text-accent active:bg-sunken"
      >
        <Plus size={16} />
        Add food
      </button>
    </Card>
  )
}

/**
 * What a sitting was, in one line: the biggest item by calories, and how many others.
 *
 * Naming the largest rather than the first, because that's the one a person recognises the meal by
 * — "Chicken breast +3" reads as a meal, "Olive oil +3" reads as nothing.
 */
function summarise(entries: readonly LogEntry[], foods: ReadonlyMap<string, Food>): string {
  const sorted = [...entries].sort((a, b) => b.nutrients.kcal - a.nutrients.kcal)
  const first = sorted[0]
  if (!first) return MEAL_LABELS[entries[0]!.meal]
  const name = entryName(first, foods)
  return sorted.length === 1 ? name : `${name} +${sorted.length - 1}`
}
