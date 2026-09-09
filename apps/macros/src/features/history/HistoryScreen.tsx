import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { dayKey, dayKeyOffset, formatRelativeDay, formatTimeOfDay } from '@tracker-engine/core'
import {
  Card,
  FilterChipButton,
  FilterSheet,
  SearchField,
  SegmentedTabs,
  useToast,
  type SegmentedTab,
} from '@tracker-engine/ui'
import { ChevronDown, Copy } from 'lucide-react'
import * as repo from '@/data/repository'
import { cn } from '@/lib/cn'
import { dailyAverage, dayTotals } from '@/lib/nutrition'
import { dayTiming, eatingOccasions, formatDuration } from '@/lib/mealTiming'
import { grams } from '@/features/shared/format'
import { MEAL_LABELS } from '@/features/shared/meals'
import { entryName, foodIdsOf } from '@/features/shared/entryName'
import { MEAL_SLOTS, type Food, type LogEntry, type MacroTargets, type MealSlot } from '@/domain/types'

const RANGES = [
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
  { key: '1y', label: '1 year', days: 365 },
  { key: 'all', label: 'All time', days: 3650 },
] as const

type RangeKey = (typeof RANGES)[number]['key']
type SortKey = 'newest' | 'oldest' | 'most' | 'least'

const SORTS: SegmentedTab<SortKey>[] = [
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'most', label: 'Most kcal' },
  { key: 'least', label: 'Least' },
]

/**
 * Every logged day: searchable, filterable, sortable, and openable.
 *
 * Each day is judged against the target that was in force *then*, not today's: a check-in for a
 * past week is an immutable record, so changing a goal now must not turn last month into a month
 * of failures.
 */
export function HistoryScreen() {
  const toast = useToast()
  const today = dayKey(Date.now())
  const [rangeKey, setRangeKey] = useState<RangeKey>('30d')
  const [sort, setSort] = useState<SortKey>('newest')
  const [query, setQuery] = useState('')
  const [meals, setMeals] = useState<string[]>([])
  const [openSheet, setOpenSheet] = useState<'range' | 'meal' | null>(null)
  const [openDay, setOpenDay] = useState<string | null>(null)

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
      if (!needle) return true
      return entryName(entry, foods ?? new Map()).toLowerCase().includes(needle)
    })
  }, [entries, foods, meals, query])

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
  const isFiltered = query.trim() !== '' || meals.length > 0

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
          {isFiltered && (
            <button
              onClick={() => {
                setQuery('')
                setMeals([])
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
            isOpen={openDay === day}
            onToggle={() => setOpenDay((current) => (current === day ? null : day))}
            onCopy={() => {
              void repo.copyDay(day, today).then((n) => toast.show(`Copied ${n} items`))
            }}
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
    </div>
  )
}

function DayCard({
  day,
  entries,
  foods,
  target,
  isPartial,
  isOpen,
  onToggle,
  onCopy,
}: {
  day: string
  entries: LogEntry[]
  foods: ReadonlyMap<string, Food>
  target: MacroTargets | null
  /** True when filters are on, so the totals are of the matches rather than the whole day. */
  isPartial: boolean
  isOpen: boolean
  onToggle: () => void
  onCopy: () => void
}) {
  const totals = dayTotals(entries)
  const delta = target && !isPartial ? totals.kcal - target.kcal : null
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
            {isPartial && ` · ${entries.length} match${entries.length === 1 ? '' : 'es'}`}
            {!isPartial &&
              timing.spanMinutes !== null &&
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
          {target === null && !isPartial && (
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
                      <span className="block truncate text-[13.5px]">{entryName(entry, foods)}</span>
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

