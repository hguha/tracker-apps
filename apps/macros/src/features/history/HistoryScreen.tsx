import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { dayKey, dayKeyOffset, formatRelativeDay } from '@tracker-engine/core'
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
import { entryName, foodIdsOf } from '@/features/shared/entryName'
import { MacroNumbers } from '@/features/shared/MacroNumbers'
import { MacroSplitBar } from '@/features/shared/MacroSplitBar'
import { mealGroups } from '@/lib/dayGroups'
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

  const entries = useLiveQuery(() => repo.entriesBetween(from, today), [from, today], [])
  const foods = useLiveQuery(
    async () => repo.foodsByIds(foodIdsOf(entries ?? [])),
    [entries],
    new Map<string, Food>(),
  )

  // Filters apply to entries first, so a day only appears when something in it matches — the
  // alternative (filter the days, show every entry) makes a search result lie about its own hits.
  const matching = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (entries ?? []).filter((entry) => {
      if (meals.length > 0 && !meals.includes(entry.meal)) return false
      if (venues.length > 0 && !venues.includes(entry.venue ?? 'none')) return false
      if (!needle) return true
      return entryName(entry, foods ?? new Map()).toLowerCase().includes(needle)
    })
  }, [entries, foods, meals, venues, query])

  const byDay = new Map<string, LogEntry[]>()
  for (const entry of matching) {
    byDay.set(entry.day, [...(byDay.get(entry.day) ?? []), entry])
  }

  const days = [...byDay.keys()].sort((a, b) => {
    if (sort === 'newest') return b.localeCompare(a)
    if (sort === 'oldest') return a.localeCompare(b)
    const kcalA = dayTotals(byDay.get(a) ?? []).kcal
    const kcalB = dayTotals(byDay.get(b) ?? []).kcal
    return sort === 'most' ? kcalB - kcalA : kcalA - kcalB
  })

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
        {days.length === 0 ? (
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

  return (
    <Card className="p-0">
      <div className="flex items-center">
        <button
          onClick={onOpen}
          className="min-w-0 flex-1 px-4 py-3 text-left active:bg-sunken"
        >
          <div className="flex items-baseline gap-2">
            <h2 className="flex-1 truncate text-[15px] font-semibold tracking-tight">
              {formatRelativeDay(Date.parse(`${day}T12:00:00`))}
            </h2>
            <span className="tabular text-[14px] font-semibold">{totals.kcal}</span>
            <ChevronRight size={16} className="shrink-0 text-ink-muted" />
          </div>
          <p className="tabular mt-0.5 flex items-baseline gap-2 text-[12.5px] text-ink-muted">
            <MacroNumbers nutrients={totals} />
            <span>
            {delta !== null &&
              ` · ${delta === 0 ? 'on target' : `${Math.abs(delta)} kcal ${delta > 0 ? 'over' : 'under'}`}`}
            {isPartial && ` · ${entries.length} match${entries.length === 1 ? '' : 'es'}`}
            {!isPartial &&
              timing.spanMinutes !== null &&
              ` · ${mealGroups(entries).length} meals over ${formatDuration(timing.spanMinutes)}`}
            </span>
          </p>
        </button>
      </div>

      {/*
        One bar for the day, not one per sitting.
        Thirty days of five meals was a hundred and fifty little bars on one scroll — the pattern a
        chart is supposed to reveal, rendered as noise. The day's own split is the useful shape here;
        the per-meal breakdown belongs on the day screen, one tap away.
      */}
      <div className="px-4 pb-3">
        <MacroSplitBar nutrients={totals} />
        <p className="tabular mt-1.5 flex items-baseline gap-2 text-[11.5px] text-ink-muted">
          <span className="min-w-0 flex-1 truncate">{summarise(entries, foods)}</span>
          <VenueSummary entries={entries} />
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
 * What the day was, in one line: how many meals, and the biggest thing in it.
 *
 * Enough to recognise a day by without listing it. "4 meals · Chicken breast, Guacamole" answers
 * "which day was that" far faster than fifteen rows of grams do.
 */
function summarise(entries: readonly LogEntry[], foods: ReadonlyMap<string, Food>): string {
  const occasions = eatingOccasions(entries)
  const top = [...entries]
    .sort((a, b) => b.nutrients.kcal - a.nutrients.kcal)
    .slice(0, 2)
    .map((entry) => entryName(entry, foods))
  return [
    `${occasions.length} meal${occasions.length === 1 ? '' : 's'}`,
    top.join(', '),
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * Where the day's meals happened, counted.
 *
 * With one bar per day the per-sitting venue chips had nowhere to live, and a "Where" filter with
 * no visible venues is a filter you can't check. "2 home · 1 out" keeps the answer on the row that
 * matched it.
 */
function VenueSummary({ entries }: { entries: readonly LogEntry[] }) {
  const counts = new Map<Venue, number>()
  for (const occasion of eatingOccasions(entries)) {
    const venue = occasion.entries.find((entry) => entry.venue !== null)?.venue
    if (venue) counts.set(venue, (counts.get(venue) ?? 0) + 1)
  }
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
