import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  dayKey,
  dayKeyOffset,
  dayNoon,
  formatRelativeDay,
  groupBy,
  plural,
} from '@tracker-engine/core'
import {
  Card,
  FilterChipButton,
  FilterSheet,
  SearchField,
  SegmentedTabs,
  type SegmentedTab,
} from '@tracker-engine/ui'
import { ChevronRight } from 'lucide-react'
import * as repo from '@/data/repository'
import { dailyAverage, dayTotals } from '@/lib/nutrition'
import { dayTiming, eatingOccasions, formatDuration } from '@/lib/mealTiming'
import { grams } from '@/features/shared/format'
import { MEAL_LABELS } from '@/lib/meals'
import { entryName, foodIdsOf, searchableNames } from '@/features/shared/entryName'
import { MacroSplitBar } from '@/features/shared/MacroSplitBar'
import { dishGroups, mealGroups } from '@/lib/dayGroups'
import { VENUE_ICONS, VENUE_LONG, venueLabel } from '@/features/shared/venue'
import {
  MEAL_SLOTS,
  VENUES,
  type Food,
  type LogEntry,
  type MacroTargets,
  type MealSlot,
  type Venue,
} from '@/domain/types'

const RANGES = [
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
  { key: '1y', label: '1 year', days: 365 },
  { key: 'all', label: 'All time', days: 3650 },
] as const

type RangeKey = (typeof RANGES)[number]['key']
/**
 * Two orders, not four.
 *
 * "Most kcal" and "Least" were dropped: a diary sorted by calorie descending answers no question
 * anybody asks of their own history, and the thing they were standing in for — which days ran over —
 * is what the Insights charts are for.
 */
type SortKey = 'newest' | 'oldest'

const SORTS: SegmentedTab<SortKey>[] = [
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
]

/**
 * Every logged day: searchable, filterable, sortable, and openable.
 *
 * Each day is judged against the target that was in force *then*, not today's: a check-in for a
 * past week is an immutable record, so changing a goal now must not turn last month into a month
 * of failures.
 */
export function HistoryScreen({ onOpenDay }: { onOpenDay: (day: string) => void }) {
  const today = dayKey(Date.now())
  const [rangeKey, setRangeKey] = useState<RangeKey>('30d')
  const [sort, setSort] = useState<SortKey>('newest')
  const [query, setQuery] = useState('')
  const [meals, setMeals] = useState<string[]>([])
  const [venues, setVenues] = useState<string[]>([])
  const [openSheet, setOpenSheet] = useState<'range' | 'meal' | 'venue' | null>(null)

  const range = RANGES.find((option) => option.key === rangeKey)!
  const from = dayKeyOffset(Date.now(), range.days)

  /**
   * `undefined` until loaded, not `[]`.
   *
   * A live query given `[]` is indistinguishable from one that found nothing, so opening History
   * showed **"Nothing logged yet."** for the first frame — a flat statement that the diary is empty,
   * on the screen whose whole job is the diary.
   */
  const entries = useLiveQuery(() => repo.entriesBetween(from, today), [from, today], undefined)
  const foods = useLiveQuery(
    async () => repo.foodsByIds(foodIdsOf(entries ?? [])),
    [entries],
    new Map<string, Food>(),
  )
  const isLoaded = entries !== undefined

  // Filters apply to entries first, so a day only appears when something in it matches — the
  // alternative (filter the days, show every entry) makes a search result lie about its own hits.
  const matching = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (entries ?? []).filter((entry) => {
      if (meals.length > 0 && !meals.includes(entry.meal)) return false
      if (venues.length > 0 && !venues.includes(entry.venue ?? 'none')) return false
      if (!needle) return true
      return searchableNames(entry, foods ?? new Map()).toLowerCase().includes(needle)
    })
  }, [entries, foods, meals, venues, query])

  const byDay = groupBy(matching, (entry) => entry.day)

  const days = [...byDay.keys()].sort((a, b) =>
    sort === 'newest' ? b.localeCompare(a) : a.localeCompare(b),
  )

  const targets = useLiveQuery(() => repo.targetsByDay(days), [days.join(',')], new Map())
  const averages = dailyAverage(matching)
  const isFiltered = query.trim() !== '' || meals.length > 0 || venues.length > 0

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-line bg-surface px-3 py-2">
        <SearchField value={query} onChange={setQuery} placeholder="Search what you ate" />
        <div className="flex gap-1.5 overflow-x-auto">
          <FilterChipButton label={range.label} isActive onClick={() => setOpenSheet('range')} />
          <FilterChipButton
            label={
              meals.length === 0
                ? 'Meal'
                : meals.length === 1
                  ? MEAL_LABELS[meals[0] as MealSlot]
                  : `${meals.length} meals`
            }
            isActive={meals.length > 0}
            onClick={() => setOpenSheet('meal')}
          />
          <FilterChipButton
            label={
              venues.length === 0
                ? 'Where'
                : venues.length === 1
                  ? venueLabel(venues[0] === 'none' ? null : (venues[0] as Venue))
                  : `${venues.length} places`
            }
            isActive={venues.length > 0}
            onClick={() => setOpenSheet('venue')}
          />
          {isFiltered && (
            <button
              onClick={() => {
                setQuery('')
                setMeals([])
                setVenues([])
              }}
              className="shrink-0 px-2 text-[13px] font-semibold text-accent"
            >
              Clear
            </button>
          )}
        </div>
        <SegmentedTabs tabs={SORTS} active={sort} onSelect={setSort} />
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3 pb-8">
        {!isLoaded ? null : days.length === 0 ? (
          <Card className="p-4 text-center text-[13.5px] text-ink-muted">
            {isFiltered ? 'Nothing matches these filters.' : 'Nothing logged yet.'}
          </Card>
        ) : (
          <Card className="p-4">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
              {isFiltered ? 'Matching days' : range.label}
            </h2>
            <p className="tabular mt-1 text-[20px] font-bold leading-tight">
              {averages.kcal}
              <span className="text-[13px] font-medium text-ink-muted"> kcal/day average</span>
            </p>
            <p className="tabular mt-0.5 text-[12.5px] text-ink-muted">
              {grams(averages.proteinMg)}P {grams(averages.carbsMg)}C {grams(averages.fatMg)}F ·{' '}
              {days.length} day{days.length === 1 ? '' : 's'}
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
            isPartial={isFiltered}
            onOpen={() => onOpenDay(day)}
          />
        ))}
      </div>

      {openSheet === 'range' && (
        <FilterSheet
          title="Date range"
          singleSelect
          options={RANGES.map((option) => ({ value: option.key, label: option.label }))}
          selected={[rangeKey]}
          onChange={(selected) => {
            if (selected[0]) setRangeKey(selected[0] as RangeKey)
          }}
          onDismiss={() => setOpenSheet(null)}
        />
      )}

      {openSheet === 'meal' && (
        <FilterSheet
          title="Meal"
          options={MEAL_SLOTS.map((slot) => ({ value: slot, label: MEAL_LABELS[slot] }))}
          selected={meals}
          onChange={setMeals}
          onDismiss={() => setOpenSheet(null)}
        />
      )}

      {openSheet === 'venue' && (
        <FilterSheet
          title="Where you ate"
          options={[
            ...VENUES.map((venue) => ({ value: venue, label: VENUE_LONG[venue] })),
            { value: 'none', label: 'Not recorded' },
          ]}
          selected={venues}
          onChange={setVenues}
          onDismiss={() => setOpenSheet(null)}
        />
      )}
    </div>
  )
}

function DayCard({
  day,
  entries,
  foods,
  target,
  isPartial,
  onOpen,
}: {
  day: string
  entries: LogEntry[]
  foods: ReadonlyMap<string, Food>
  target: MacroTargets | null
  /** True when filters are on, so the totals are of the matches rather than the whole day. */
  isPartial: boolean
  onOpen: () => void
}) {
  const totals = dayTotals(entries)
  const delta = target && !isPartial ? totals.kcal - target.kcal : null
  const timing = dayTiming(entries)
  const venues = venueCounts(entries)
  const meals = mealGroups(entries).length

  // Joined rather than concatenated with leading separators: the macro figures used to open this line
  // and moved into the bar, which left a stray "· " at the front of every row.
  const parts: string[] = []
  if (delta !== null) {
    parts.push(
      delta === 0 ? 'on target' : `${Math.abs(delta)} kcal ${delta > 0 ? 'over' : 'under'}`,
    )
  }
  if (isPartial) parts.push(`${entries.length} match${entries.length === 1 ? '' : 'es'}`)
  // The span, not the meal count: that moved down beside the venue chips, where it fills a line that
  // otherwise held a floating icon and nothing else.
  if (!isPartial && timing.spanMinutes !== null) parts.push(`over ${formatDuration(timing.spanMinutes)}`)
  const subtitle = parts.join(' · ')

  return (
    <Card className="p-0">
      <div className="flex items-center">
        <button
          onClick={onOpen}
          className="min-w-0 flex-1 px-4 py-3 text-left active:bg-sunken"
        >
          <div className="flex items-baseline gap-2">
            <h2 className="flex-1 truncate text-[15px] font-semibold tracking-tight">
              {formatRelativeDay(dayNoon(day))}
            </h2>
            <span className="tabular text-[14px] font-semibold">{totals.kcal}</span>
            <ChevronRight size={16} className="shrink-0 text-ink-muted" />
          </div>
          <p className="tabular mt-0.5 text-[12.5px] text-ink-muted">{subtitle}</p>
        </button>
      </div>

      {/*
        One bar for the day, not one per sitting.
        Thirty days of five meals was a hundred and fifty little bars on one scroll — the pattern a
        chart is supposed to reveal, rendered as noise. The day's own split is the useful shape here;
        the per-meal breakdown belongs on the day screen, one tap away.
      */}
      <div className="px-4 pb-3">
        {/* The macro numbers live *in* the bar now, rather than as a row of "44gP 50gC 6gF" above it —
            same three facts, one line instead of two, and the width says the shape while the label
            says the amount. */}
        <MacroSplitBar nutrients={totals} />
        {/*
          Named foods only when a search is on, and then the ones that *matched*.
          Unfiltered it listed the day's two biggest items, which reads as an arbitrary pick — and it
          was: a day with carrot cake in it never mentioned the carrot cake, but typing "carrot" made
          it appear, so the line looked like it was hiding things. Its only real use was confirming a
          search hit, so that is all it does now.
        */}
        <p className="tabular mt-1.5 flex items-baseline gap-2 text-[11.5px] text-ink-muted">
          <span className="min-w-0 flex-1 truncate">
            {isPartial
              ? matchedNames(entries, foods)
              : plural(meals, 'meal')}
          </span>
          <VenueSummary counts={venues} />
        </p>
      </div>

      {target === null && !isPartial && (
        <p className="border-t border-line px-4 py-2 text-[12px] text-ink-muted">
          No target was in force yet on this day.
        </p>
      )}
    </Card>
  )
}

/**
 * What matched, on a day a search brought back.
 *
 * Dishes rather than their rows: a hit on "3 steak tacos" should say that, not name the two heaviest
 * USDA components of it.
 */
function matchedNames(entries: readonly LogEntry[], foods: ReadonlyMap<string, Food>): string {
  return dishGroups(entries)
    .map((group) => group.name ?? entryName(group.entries[0]!, foods))
    .join(', ')
}

/** How many of the day's sittings happened where. Counted outside the component so the row above
 *  can decide whether it has anything to say at all. */
function venueCounts(entries: readonly LogEntry[]): Map<Venue, number> {
  const counts = new Map<Venue, number>()
  for (const occasion of eatingOccasions(entries)) {
    const venue = occasion.entries.find((entry) => entry.venue !== null)?.venue
    if (venue) counts.set(venue, (counts.get(venue) ?? 0) + 1)
  }
  return counts
}

/**
 * Where the day's meals happened.
 *
 * With one bar per day the per-sitting venue chips had nowhere to live, and a "Where" filter with
 * no visible venues is a filter you can't check. "2 home · 1 out" keeps the answer on the row that
 * matched it.
 */
function VenueSummary({ counts }: { counts: Map<Venue, number> }) {
  if (counts.size === 0) return null

  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {[...counts].map(([venue, count]) => {
        const Icon = VENUE_ICONS[venue]
        return (
          <span key={venue} className="flex items-center gap-0.5" title={VENUE_LONG[venue]}>
            <Icon size={10} />
            {count}
          </span>
        )
      })}
    </span>
  )
}
