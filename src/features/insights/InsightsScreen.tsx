/**
 * Insights (§9, §9.0).
 *
 * Navigation is structured rather than flat, because 41 charts and a 200-exercise
 * library cannot be driven from a row of pills — past ~10 options the pills wrap
 * into a wall and stop being scannable:
 *
 *   - A fixed **sub-tab row** partitions the catalog into five areas.
 *   - One **filter bar** scopes every chart in the active sub-tab. Its controls
 *     are summary chips that open searchable sheets, so the bar stays one line
 *     no matter how much data exists.
 *
 * Per-chart filters are forbidden: two charts on one screen showing different
 * slices quietly lie about the comparison.
 */

import { useMemo, useState } from 'react'
import { TrendingUp } from 'lucide-react'
import { FilterChipButton, FilterSheet } from '@/components/FilterSheet'
import { Card } from '@/components/Card'
import { cn } from '@/lib/cn'
import { regionVar } from '@/lib/palette'
import { REGION_LABELS, REGIONS, type Region } from '@/domain/types'
import { formatDuration, weightFromKg } from '@/lib/units'
import { useInsightsData, type InsightsData, type InsightsFilters } from './useInsightsData'
import {
  BodyweightChart,
  CardioChart,
  DayOfWeekChart,
  DurationTrendChart,
  EquipmentMixChart,
  ExerciseVarietyChart,
  GapDistributionChart,
  PatternCoverageChart,
  PerExerciseVolumeChart,
  RegionShareChart,
  RegionVolumeOverTimeChart,
  RepRangeChart,
  SetsByRegionChart,
  SetsPerSessionChart,
  StalledLiftsChart,
  StrengthProgressionChart,
  TimeOfDayChart,
  TopSetChart,
  VolumeVsDurationChart,
  WeeklyVolumeChart,
  WorkoutsPerWeekChart,
} from './charts'
import { PrEstimator } from './PrEstimator'

const RANGES = [
  { key: '4w', label: '4 weeks', weeks: 4 },
  { key: '12w', label: '12 weeks', weeks: 12 },
  { key: '6m', label: '6 months', weeks: 26 },
  { key: '1y', label: '1 year', weeks: 52 },
  { key: 'all', label: 'All time', weeks: 520 },
] as const

type RangeKey = (typeof RANGES)[number]['key']

const SUB_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'strength', label: 'Strength' },
  { key: 'volume', label: 'Volume' },
  { key: 'consistency', label: 'Habit' },
  { key: 'body', label: 'Body' },
] as const

type SubTabKey = (typeof SUB_TABS)[number]['key']

export function InsightsScreen() {
  const [subTab, setSubTab] = useState<SubTabKey>('overview')
  const [rangeKey, setRangeKey] = useState<RangeKey>('12w')
  const [regions, setRegions] = useState<string[]>([])
  const [exerciseIds, setExerciseIds] = useState<string[]>([])
  const [openSheet, setOpenSheet] = useState<'range' | 'region' | 'exercise' | null>(null)

  const range = RANGES.find((r) => r.key === rangeKey)!

  // Single-lift charts (strength progression, top set) follow the shared
  // Exercise filter rather than a per-chart control (§9.0). One explicit pick
  // is the subject; otherwise the most-trained lift is shown with a hint.
  const isExerciseExplicit = exerciseIds.length === 1
  const activeExerciseId = isExerciseExplicit ? exerciseIds[0]! : null

  const filters: InsightsFilters = useMemo(
    () => ({ weeks: range.weeks, regions, exerciseIds }),
    [range.weeks, regions, exerciseIds],
  )

  const data = useInsightsData(filters)

  if (!data) return <div className="p-6 text-ink-muted">Loading…</div>

  const hasAnyHistory = data.exerciseOptions.length > 0

  return (
    <div className="flex h-full flex-col">
      {/* Sub-tabs: fixed, never wraps, always visible. */}
      <div className="flex gap-1 overflow-x-auto border-b border-line bg-surface px-2 py-1.5">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setSubTab(tab.key)}
            className={cn(
              'shrink-0 rounded-lg px-3 py-1.5 text-[13.5px] font-semibold',
              subTab === tab.key
                ? 'bg-accent-wash text-accent'
                : 'text-ink-secondary active:bg-sunken',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* One filter bar, scoping every chart below it. */}
      <div className="flex gap-1.5 overflow-x-auto border-b border-line bg-surface px-3 py-2">
        <FilterChipButton
          label={range.label}
          isActive
          onClick={() => setOpenSheet('range')}
        />
        <FilterChipButton
          label={summarize('Body part', regions, (v) => REGION_LABELS[v as Region])}
          isActive={regions.length > 0}
          onClick={() => setOpenSheet('region')}
        />
        <FilterChipButton
          label={summarize(
            'Exercise',
            exerciseIds,
            (id) => data.exerciseOptions.find((e) => e.id === id)?.name ?? 'Exercise',
          )}
          isActive={exerciseIds.length > 0}
          onClick={() => setOpenSheet('exercise')}
        />
        {(regions.length > 0 || exerciseIds.length > 0) && (
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
            {subTab === 'overview' && (
              <>
                <SummaryCard data={data} rangeLabel={range.label} />
                <WeeklyVolumeChart data={data} />
                <SetsByRegionChart data={data} />
                <RegionShareChart data={data} />
              </>
            )}

            {subTab === 'strength' && (
              <>
                <PrEstimator data={data} />
                <StrengthProgressionChart
                  data={data}
                  activeExerciseId={activeExerciseId}
                />
                <TopSetChart data={data} activeExerciseId={activeExerciseId} />
                <PerExerciseVolumeChart data={data} activeExerciseId={activeExerciseId} />
                <RepRangeChart data={data} />
                <StalledLiftsChart data={data} />
              </>
            )}

            {subTab === 'volume' && (
              <>
                <RegionVolumeOverTimeChart data={data} />
                <RegionShareChart data={data} />
                <SetsByRegionChart data={data} />
                <PatternCoverageChart data={data} />
                <EquipmentMixChart data={data} />
                <SetsPerSessionChart data={data} />
                <ExerciseVarietyChart data={data} />
                <VolumeVsDurationChart data={data} />
              </>
            )}

            {subTab === 'consistency' && (
              <>
                <WorkoutsPerWeekChart data={data} />
                <DayOfWeekChart data={data} />
                <TimeOfDayChart data={data} />
                <DurationTrendChart data={data} />
                <GapDistributionChart data={data} />
                <CardioChart data={data} />
              </>
            )}

            {subTab === 'body' && (
              <>
                <BodyweightChart data={data} />
                <Card className="p-4">
                  <h2 className="text-[15px] font-semibold tracking-tight">
                    More body charts
                  </h2>
                  <p className="mt-1 text-[13px] text-ink-secondary">
                    Body composition, circumferences, vitals, and sleep-vs-training
                    charts arrive once there's enough logged data to plot. Log
                    measurements under More to start filling them in.
                  </p>
                </Card>
              </>
            )}
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

/** Headline numbers for the active filter scope. Stat tiles, not a chart. */
function SummaryCard({
  data,
  rangeLabel,
}: {
  data: InsightsData
  rangeLabel: string
}) {
  const unit = data.profile.unitWeight
  return (
    <Card className="p-4">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
        Last {rangeLabel.toLowerCase()}
      </p>
      {/* A hero figure, not a one-bar chart. */}
      <p className="mt-1 text-[36px] font-bold leading-none tracking-tight">
        {Math.round(weightFromKg(data.totalVolumeKg, unit)).toLocaleString()}
        <span className="ml-1.5 text-[15px] font-semibold text-ink-muted">
          {unit} lifted
        </span>
      </p>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
        <Stat label="Workouts" value={String(data.workoutCount)} />
        <Stat label="Sets" value={String(data.totalSets)} />
        {data.cardioSeconds > 0 && (
          <Stat label="Cardio" value={formatDuration(data.cardioSeconds)} />
        )}
      </div>
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[19px] font-bold leading-tight">{value}</p>
      <p className="text-[11.5px] text-ink-muted">{label}</p>
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
