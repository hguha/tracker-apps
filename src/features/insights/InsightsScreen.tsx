/**
 * Insights (§9, §9.0).
 *
 * Navigation is structured rather than flat, because 40+ charts and a
 * 200-exercise library cannot be driven from a row of pills:
 *
 *   - A fixed **sub-tab row** partitions the catalog into five areas.
 *   - A **filter bar** scopes every chart in the active sub-tab — but shows only
 *     the controls those charts actually use. A tab whose charts ignore body
 *     part (e.g. Habit) doesn't show a Body-part chip that changes nothing.
 *
 * The catalog (`catalog.tsx`) is the source of truth: each chart declares the
 * filters it consumes and how to render, and each sub-tab lists chart keys.
 * Adding or re-scoping a chart is a catalog edit, not a screen edit.
 *
 * Per-chart filters remain forbidden: two charts on one screen showing different
 * slices quietly lie about the comparison. The per-tab bar scopes all of them at
 * once.
 */

import { useMemo, useState } from 'react'
import { TrendingUp } from 'lucide-react'
import { FilterChipButton, FilterSheet } from '@/components/FilterSheet'
import { regionVar } from '@/lib/palette'
import { REGION_LABELS, REGIONS, type Region } from '@/domain/types'
import { useInsightsData, type InsightsFilters } from './useInsightsData'
import { CHART_CATALOG, SUB_TABS, filtersForSubTab, type ChartContext } from './catalog'
import { cn } from '@/lib/cn'

const RANGES = [
  { key: '4w', label: '4 weeks', weeks: 4 },
  { key: '12w', label: '12 weeks', weeks: 12 },
  { key: '6m', label: '6 months', weeks: 26 },
  { key: '1y', label: '1 year', weeks: 52 },
  { key: 'all', label: 'All time', weeks: 520 },
] as const

type RangeKey = (typeof RANGES)[number]['key']

export function InsightsScreen() {
  const [subTabKey, setSubTabKey] = useState<string>(SUB_TABS[0]!.key)
  const [rangeKey, setRangeKey] = useState<RangeKey>('12w')
  const [regions, setRegions] = useState<string[]>([])
  const [exerciseIds, setExerciseIds] = useState<string[]>([])
  const [openSheet, setOpenSheet] = useState<'range' | 'region' | 'exercise' | null>(null)

  const range = RANGES.find((r) => r.key === rangeKey)!
  const subTab = SUB_TABS.find((t) => t.key === subTabKey) ?? SUB_TABS[0]!

  // Which non-range filters the visible tab's charts actually consume.
  const activeFilters = useMemo(() => filtersForSubTab(subTab), [subTab])
  const showRegion = activeFilters.has('region')
  const showExercise = activeFilters.has('exercise')

  // Single-lift charts (strength progression, top set) follow the shared
  // Exercise filter rather than a per-chart control (§9.0). One explicit pick
  // is the subject; otherwise the chart shows a "pick one" prompt.
  const activeExerciseId = exerciseIds.length === 1 ? exerciseIds[0]! : null

  // Only pass a filter to the aggregation when the tab uses it — so a stray
  // body-part selection left over from another tab can't silently scope a tab
  // whose bar doesn't even show that chip.
  const filters: InsightsFilters = useMemo(
    () => ({
      weeks: range.weeks,
      regions: showRegion ? regions : [],
      exerciseIds: showExercise ? exerciseIds : [],
    }),
    [range.weeks, showRegion, regions, showExercise, exerciseIds],
  )

  const data = useInsightsData(filters)

  if (!data) return <div className="p-6 text-ink-muted">Loading…</div>

  const hasAnyHistory = data.exerciseOptions.length > 0

  const ctx: ChartContext = {
    data,
    rangeLabel: range.label,
    activeExerciseId,
  }

  return (
    <div className="flex h-full flex-col">
      {/* Sub-tabs: fixed, never wraps, always visible. */}
      <div className="flex gap-1 overflow-x-auto border-b border-line bg-surface px-2 py-1.5">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setSubTabKey(tab.key)}
            className={cn(
              'shrink-0 rounded-lg px-3 py-1.5 text-[13.5px] font-semibold',
              subTab.key === tab.key
                ? 'bg-accent-wash text-accent'
                : 'text-ink-secondary active:bg-sunken',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* One filter bar, scoping every chart below it — only the chips this tab's
          charts respond to. Range is universal, so it always shows. */}
      <div className="flex gap-1.5 overflow-x-auto border-b border-line bg-surface px-3 py-2">
        <FilterChipButton
          label={range.label}
          isActive
          onClick={() => setOpenSheet('range')}
        />
        {showRegion && (
          <FilterChipButton
            label={summarize('Body part', regions, (v) => REGION_LABELS[v as Region])}
            isActive={regions.length > 0}
            onClick={() => setOpenSheet('region')}
          />
        )}
        {showExercise && (
          <FilterChipButton
            label={summarize(
              'Exercise',
              exerciseIds,
              (id) => data.exerciseOptions.find((e) => e.id === id)?.name ?? 'Exercise',
            )}
            isActive={exerciseIds.length > 0}
            onClick={() => setOpenSheet('exercise')}
          />
        )}
        {((showRegion && regions.length > 0) ||
          (showExercise && exerciseIds.length > 0)) && (
          <button
            onClick={() => {
              setRegions([])
              setExerciseIds([])
            }}
            className="shrink-0 px-2 text-[13px] font-semibold text-accent"
          >
            Clear
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {!hasAnyHistory ? (
          <div className="mt-20 px-6 text-center">
            <TrendingUp size={28} className="mx-auto text-ink-muted" />
            <p className="mt-3 text-[16px] font-semibold">Nothing to chart yet</p>
            <p className="mt-1 text-[14px] text-ink-muted">
              Log a few workouts and the trends will show up here.
            </p>
          </div>
        ) : data.workoutCount === 0 ? (
          <div className="mt-16 px-6 text-center">
            <p className="text-[15px] font-semibold">No workouts match these filters</p>
            <p className="mt-1 text-[13.5px] text-ink-muted">
              Try a longer date range, or clear the body-part and exercise filters.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {subTab.charts.map((chartKey) => {
              const chart = CHART_CATALOG[chartKey]
              if (!chart) return null
              return <div key={chartKey}>{chart.render(ctx)}</div>
            })}
          </div>
        )}
        <div className="h-4" />
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

      {openSheet === 'region' && (
        <FilterSheet
          title="Body part"
          options={REGIONS.map((region) => ({
            value: region,
            label: REGION_LABELS[region],
            swatch: regionVar(region),
          }))}
          selected={regions}
          onChange={setRegions}
          onDismiss={() => setOpenSheet(null)}
        />
      )}

      {openSheet === 'exercise' && (
        <FilterSheet
          title="Exercise"
          // Grouped by body part and searchable — this is what keeps the control
          // usable once there are 200 exercises in the library.
          options={groupExercisesByRegion(data.exerciseOptions)}
          selected={exerciseIds}
          onChange={setExerciseIds}
          onDismiss={() => setOpenSheet(null)}
        />
      )}
    </div>
  )
}

/** "All exercises" / "Bench Press" / "Bench Press +2" — never grows with the data. */
function summarize(
  noun: string,
  selected: string[],
  labelOf: (value: string) => string,
): string {
  if (selected.length === 0) return `All ${noun.toLowerCase()}s`
  if (selected.length === 1) return labelOf(selected[0]!)
  return `${labelOf(selected[0]!)} +${selected.length - 1}`
}

function groupExercisesByRegion(
  options: { id: string; name: string; region: Region | undefined }[],
) {
  // Region order matches the palette's fixed slot order, so the sheet reads in
  // the same sequence as every chart legend.
  const ordered = [...options].sort((a, b) => {
    const aIndex = a.region ? REGIONS.indexOf(a.region) : REGIONS.length
    const bIndex = b.region ? REGIONS.indexOf(b.region) : REGIONS.length
    if (aIndex !== bIndex) return aIndex - bIndex
    return a.name.localeCompare(b.name)
  })

  return ordered.map((option) => ({
    value: option.id,
    label: option.name,
    swatch: option.region ? regionVar(option.region) : undefined,
    group: option.region ? REGION_LABELS[option.region] : 'Other',
  }))
}
