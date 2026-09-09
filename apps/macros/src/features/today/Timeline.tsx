import { useState } from 'react'
import { formatTimeOfDay } from '@tracker-engine/core'
import { Card } from '@tracker-engine/ui'
import { Bookmark, ChevronDown, Plus } from 'lucide-react'
import { cn } from '@/lib/cn'
import * as repo from '@/data/repository'
import { dayTiming, eatingOccasions, formatDuration } from '@/lib/mealTiming'
import { MEAL_LABELS } from '@/features/shared/meals'
import { entryName } from '@/features/shared/entryName'
import { VENUE_ICONS, VENUE_LABELS, VENUE_LONG } from '@/features/shared/venue'
import { VENUES, type Food, type LogEntry } from '@/domain/types'

/** Past this many items the card starts collapsed: a long log otherwise pushes every other
 *  card off the screen, and the totals above it are what most opens are actually for. */
const COLLAPSE_ABOVE = 5

/**
 * What was eaten, in the order it was eaten.
 *
 * Grouped by eating occasion rather than by breakfast/lunch/dinner: five small meals and one
 * large one are genuinely different days, and a screen with four fixed meal boxes can't show
 * that difference — it also can't show a 2pm snack as anything other than a filing decision.
 *
 * One line per item, with the macro breakdown a tap away in the edit sheet. Repeating
 * "39gP 0gC 5gF" down a screen of fifteen items is noise at the size it has to be rendered.
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
  /** The sitting comes along, because meal, time and venue all belong to it rather than the row. */
  onEdit: (entry: LogEntry, siblings: LogEntry[]) => void
  onSaveMeal: (entries: LogEntry[]) => void
}) {
  const occasions = eatingOccasions(entries)
  const timing = dayTiming(entries)
  // null = follow the length; once tapped, the user's choice wins for this mount.
  const [isOpen, setIsOpen] = useState<boolean | null>(null)
  const shown = isOpen ?? entries.length <= COLLAPSE_ABOVE

  return (
    <Card className="p-0">
      <button
        onClick={() => setIsOpen(!shown)}
        aria-expanded={shown}
        className="flex w-full items-baseline gap-2 px-4 py-3 text-left active:bg-sunken"
      >
        <h2 className="shrink-0 text-[15px] font-semibold tracking-tight">Today&rsquo;s food</h2>
        <span className="tabular min-w-0 flex-1 truncate text-[12px] text-ink-muted">
          {entries.length === 0
            ? 'nothing yet'
            : `${entries.length} item${entries.length === 1 ? '' : 's'}` +
              (occasions.length > 1 ? ` · ${occasions.length} meals` : '') +
              (timing.firstAt !== null
                ? ` · ${formatTimeOfDay(timing.firstAt)}–${formatTimeOfDay(timing.lastAt ?? timing.firstAt)}`
                : '')}
        </span>
        <ChevronDown
          size={17}
          className={cn('shrink-0 text-ink-muted transition-transform', shown && 'rotate-180')}
        />
      </button>

      {shown && (
        <>
          {occasions.length > 1 && timing.spanMinutes !== null && (
            <p className="px-4 pb-2 text-[12px] text-ink-muted">
              {formatDuration(timing.spanMinutes)} from first to last
              {timing.largestShare !== null &&
                ` · biggest meal ${Math.round(timing.largestShare * 100)}% of the day`}
            </p>
          )}

          {occasions.map((occasion) => (
            <div key={occasion.startAt} className="border-t border-line">
              <div className="flex items-center gap-2 px-4 pb-0.5 pt-2">
                <span className="tabular flex-1 text-[12.5px] font-semibold">
                  {formatTimeOfDay(occasion.startAt)}
                  <span className="font-normal text-ink-muted">
                    {' '}
                    · {MEAL_LABELS[occasion.entries[0]!.meal]} · {occasion.nutrients.kcal} kcal
                  </span>
                </span>
                <VenueTag entries={occasion.entries} />
                <button
                  onClick={() => onSaveMeal(occasion.entries)}
                  aria-label="Save as a meal"
                  className="flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-muted active:bg-sunken"
                >
                  <Bookmark size={14} />
                </button>
              </div>
              <ul>
                {occasion.entries.map((entry) => (
                  <li key={entry.id}>
                    <button
                      onClick={() => onEdit(entry, occasion.entries)}
                      className="flex w-full items-baseline gap-2 px-4 py-1.5 text-left active:bg-sunken"
                    >
                      <span className="min-w-0 flex-1 truncate text-[13.5px]">
                        {entryName(entry, foods)}
                        {entry.grams > 0 && (
                          <span className="tabular text-ink-muted">
                            {' '}
                            {Math.round(entry.grams)}g
                          </span>
                        )}
                        {entry.estimate && (
                          <span className="text-[11.5px] text-confidence-medium"> est</span>
                        )}
                      </span>
                      <span className="tabular shrink-0 text-[13px] text-ink-secondary">
                        {entry.nutrients.kcal}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <button
            onClick={onAdd}
            className="flex w-full items-center justify-center gap-1.5 border-t border-line py-2.5 text-[13.5px] font-semibold text-accent active:bg-sunken"
          >
            <Plus size={16} />
            Add food
          </button>
        </>
      )}
    </Card>
  )
}

/**
 * Where a sitting was eaten — shown when it's known, asked once when it isn't.
 *
 * Asked here rather than only at logging time because a chart of "eating out" is worthless until
 * most meals have an answer, and the moment you'll actually give one is while looking at the meal.
 * Three icons is one tap; a sheet would be three and get skipped.
 */
function VenueTag({ entries }: { entries: readonly LogEntry[] }) {
  const current = entries[0]?.venue ?? null
  const ids = entries.map((entry) => entry.id)

  if (current !== null) {
    const Icon = VENUE_ICONS[current]
    return (
      <button
        onClick={() => void repo.setVenue(ids, null)}
        aria-label={`Eaten ${VENUE_LABELS[current]} — tap to clear`}
        className="flex shrink-0 items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-[11px] text-ink-secondary active:opacity-60"
      >
        <Icon size={11} />
        {VENUE_LABELS[current]}
      </button>
    )
  }

  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {VENUES.map((venue) => {
        const Icon = VENUE_ICONS[venue]
        return (
          <button
            key={venue}
            onClick={() => void repo.setVenue(ids, venue)}
            aria-label={`Eaten ${VENUE_LABELS[venue].toLowerCase()}`}
            title={VENUE_LONG[venue]}
            className="flex size-6 items-center justify-center rounded-md text-ink-muted active:bg-sunken"
          >
            <Icon size={12} />
          </button>
        )
      })}
    </span>
  )
}

