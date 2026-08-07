/**
 * The Insights chart catalog, config-driven (§9, §9.0).
 *
 * Each chart is one entry declaring the filters it actually consumes and how to
 * render it. The screen reads this to (a) lay out each sub-tab from a list of
 * keys and (b) show only the filter controls the visible charts use — so the
 * Strength tab doesn't show a Body-part filter that changes nothing there, and
 * Habit doesn't show an Exercise filter it ignores.
 *
 * Adding a chart is one entry here plus its key in a sub-tab; changing what a
 * chart is scoped by is editing its `filters` array. No screen edits.
 */

import type { ReactNode } from 'react'
import type { InsightsData } from './useInsightsData'
import {
  BodyweightChart,
  CardioChart,
  DayOfWeekChart,
  DurationTrendChart,
  EquipmentMixChart,
  ExerciseVarietyChart,
  GapDistributionChart,
  MoreBodyChartsCard,
  PatternCoverageChart,
  PerExerciseVolumeChart,
  RegionShareChart,
  RegionVolumeOverTimeChart,
  RepRangeChart,
  SetsByRegionChart,
  SetsPerSessionChart,
  StalledLiftsChart,
  StrengthProgressionChart,
  SummaryCard,
  TimeOfDayChart,
  TopSetChart,
  VolumeVsDurationChart,
  WeeklyVolumeChart,
  WorkoutsPerWeekChart,
} from './charts'
import { PrEstimator } from './PrEstimator'

/** The filter controls a chart can be scoped by. Range (time) is universal, so
 *  it's implicit — every chart is time-windowed and the range chip always shows. */
export type FilterKey = 'region' | 'exercise'

/** Context handed to every chart's render — the aggregated data plus the single
 *  resolved exercise (when the Exercise filter is narrowed to exactly one). */
export interface ChartContext {
  data: InsightsData
  rangeLabel: string
  activeExerciseId: string | null
}

export interface ChartDef {
  key: string
  /** Which non-range filters meaningfully change this chart's output. */
  filters: FilterKey[]
  render: (ctx: ChartContext) => ReactNode
}

/**
 * The registry. `filters` is the source of truth for both the per-tab filter
 * bar and (later) any "what does this chart depend on" tooling.
 */
export const CHART_CATALOG: Record<string, ChartDef> = {
  summary: {
    key: 'summary',
    filters: ['region', 'exercise'],
    render: ({ data, rangeLabel }) => <SummaryCard data={data} rangeLabel={rangeLabel} />,
  },
  weeklyVolume: {
    key: 'weeklyVolume',
    filters: ['region', 'exercise'],
    render: ({ data }) => <WeeklyVolumeChart data={data} />,
  },
  setsByRegion: {
    key: 'setsByRegion',
    filters: ['region', 'exercise'],
    render: ({ data }) => <SetsByRegionChart data={data} />,
  },
  regionShare: {
    key: 'regionShare',
    filters: ['region', 'exercise'],
    render: ({ data }) => <RegionShareChart data={data} />,
  },
  regionVolumeOverTime: {
    key: 'regionVolumeOverTime',
    filters: ['region', 'exercise'],
    render: ({ data }) => <RegionVolumeOverTimeChart data={data} />,
  },
  patternCoverage: {
    key: 'patternCoverage',
    filters: ['region', 'exercise'],
    render: ({ data }) => <PatternCoverageChart data={data} />,
  },
  equipmentMix: {
    key: 'equipmentMix',
    filters: ['region', 'exercise'],
    render: ({ data }) => <EquipmentMixChart data={data} />,
  },
  setsPerSession: {
    key: 'setsPerSession',
    filters: [],
    render: ({ data }) => <SetsPerSessionChart data={data} />,
  },
  exerciseVariety: {
    key: 'exerciseVariety',
    filters: ['region'],
    render: ({ data }) => <ExerciseVarietyChart data={data} />,
  },
  volumeVsDuration: {
    key: 'volumeVsDuration',
    filters: [],
    render: ({ data }) => <VolumeVsDurationChart data={data} />,
  },

  // Strength — these follow the single-exercise selection.
  prEstimator: {
    key: 'prEstimator',
    filters: ['exercise'],
    render: ({ data }) => <PrEstimator data={data} />,
  },
  strengthProgression: {
    key: 'strengthProgression',
    filters: ['exercise'],
    render: ({ data, activeExerciseId }) => (
      <StrengthProgressionChart data={data} activeExerciseId={activeExerciseId} />
    ),
  },
  topSet: {
    key: 'topSet',
    filters: ['exercise'],
    render: ({ data, activeExerciseId }) => (
      <TopSetChart data={data} activeExerciseId={activeExerciseId} />
    ),
  },
  perExerciseVolume: {
    key: 'perExerciseVolume',
    filters: ['exercise'],
    render: ({ data, activeExerciseId }) => (
      <PerExerciseVolumeChart data={data} activeExerciseId={activeExerciseId} />
    ),
  },
  repRange: {
    key: 'repRange',
    filters: ['region', 'exercise'],
    render: ({ data }) => <RepRangeChart data={data} />,
  },
  stalledLifts: {
    key: 'stalledLifts',
    filters: ['region'],
    render: ({ data }) => <StalledLiftsChart data={data} />,
  },

  // Habit / consistency — driven by session timing, not by region or lift.
  workoutsPerWeek: {
    key: 'workoutsPerWeek',
    filters: [],
    render: ({ data }) => <WorkoutsPerWeekChart data={data} />,
  },
  dayOfWeek: {
    key: 'dayOfWeek',
    filters: [],
    render: ({ data }) => <DayOfWeekChart data={data} />,
  },
  timeOfDay: {
    key: 'timeOfDay',
    filters: [],
    render: ({ data }) => <TimeOfDayChart data={data} />,
  },
  durationTrend: {
    key: 'durationTrend',
    filters: [],
    render: ({ data }) => <DurationTrendChart data={data} />,
  },
  gapDistribution: {
    key: 'gapDistribution',
    filters: [],
    render: ({ data }) => <GapDistributionChart data={data} />,
  },
  cardio: {
    key: 'cardio',
    filters: [],
    render: ({ data }) => <CardioChart data={data} />,
  },

  // Body — bodyweight and (placeholder) future measurements.
  bodyweight: {
    key: 'bodyweight',
    filters: [],
    render: ({ data }) => <BodyweightChart data={data} />,
  },
  moreBody: {
    key: 'moreBody',
    filters: [],
    render: () => <MoreBodyChartsCard />,
  },
}

export interface SubTab {
  key: string
  label: string
  charts: string[]
}

/** The five areas and the charts each shows, in render order. */
export const SUB_TABS: SubTab[] = [
  {
    key: 'overview',
    label: 'Overview',
    charts: ['summary', 'weeklyVolume', 'setsByRegion', 'regionShare'],
  },
  {
    key: 'strength',
    label: 'Strength',
    charts: [
      'prEstimator',
      'strengthProgression',
      'topSet',
      'perExerciseVolume',
      'repRange',
      'stalledLifts',
    ],
  },
  {
    key: 'volume',
    label: 'Volume',
    charts: [
      'regionVolumeOverTime',
      'regionShare',
      'setsByRegion',
      'patternCoverage',
      'equipmentMix',
      'setsPerSession',
      'exerciseVariety',
      'volumeVsDuration',
    ],
  },
  {
    key: 'consistency',
    label: 'Habit',
    charts: [
      'workoutsPerWeek',
      'dayOfWeek',
      'timeOfDay',
      'durationTrend',
      'gapDistribution',
      'cardio',
    ],
  },
  {
    key: 'body',
    label: 'Body',
    charts: ['bodyweight', 'moreBody'],
  },
]

/** The union of non-range filters used by any chart in a sub-tab. Drives which
 *  filter chips the bar shows for that tab. */
export function filtersForSubTab(subTab: SubTab): Set<FilterKey> {
  const used = new Set<FilterKey>()
  for (const chartKey of subTab.charts) {
    for (const f of CHART_CATALOG[chartKey]?.filters ?? []) used.add(f)
  }
  return used
}
