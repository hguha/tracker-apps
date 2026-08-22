import type { ReactNode } from 'react'
import type { InsightsData } from './useInsightsData'
import {
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
  SummaryCard,
  TimeOfDayChart,
  TopSetChart,
  VolumeVsDurationChart,
  WeeklyVolumeChart,
  WorkoutsPerWeekChart,
} from './charts'
import { PrEstimator } from './PrEstimator'

// Range (time) is universal, so it's implicit rather than a FilterKey.
export type FilterKey = 'region' | 'exercise'

export interface ChartContext {
  data: InsightsData
  rangeLabel: string
  activeExerciseId: string | null
}

export interface ChartDef {
  key: string
  filters: FilterKey[]
  render: (ctx: ChartContext) => ReactNode
}

export const CHART_CATALOG: Record<string, ChartDef> = {
  summary: {
    key: 'summary',
    filters: ['region'],
    render: ({ data, rangeLabel }) => <SummaryCard data={data} rangeLabel={rangeLabel} />,
  },
  weeklyVolume: {
    key: 'weeklyVolume',
    filters: ['region'],
    render: ({ data }) => <WeeklyVolumeChart data={data} />,
  },
  setsByRegion: {
    key: 'setsByRegion',
    filters: ['region'],
    render: ({ data }) => <SetsByRegionChart data={data} />,
  },
  regionShare: {
    key: 'regionShare',
    filters: ['region'],
    render: ({ data }) => <RegionShareChart data={data} />,
  },
  regionVolumeOverTime: {
    key: 'regionVolumeOverTime',
    filters: ['region'],
    render: ({ data }) => <RegionVolumeOverTimeChart data={data} />,
  },
  patternCoverage: {
    key: 'patternCoverage',
    filters: ['region'],
    render: ({ data }) => <PatternCoverageChart data={data} />,
  },
  equipmentMix: {
    key: 'equipmentMix',
    filters: ['region'],
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
  // Rep ranges belong under Volume — a distribution across the whole range, scoped
  // by region, not a single-lift strength readout.
  repRange: {
    key: 'repRange',
    filters: ['region'],
    render: ({ data }) => <RepRangeChart data={data} />,
  },
  // No region filter: Strength shows only an exercise filter, so this stays an
  // unfiltered overview of every stalled lift.
  stalledLifts: {
    key: 'stalledLifts',
    filters: [],
    render: ({ data }) => <StalledLiftsChart data={data} />,
  },

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
}

export interface SubTab {
  key: string
  label: string
  charts: string[]
}

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
      'repRange',
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
]

export function filtersForSubTab(subTab: SubTab): Set<FilterKey> {
  const used = new Set<FilterKey>()
  for (const chartKey of subTab.charts) {
    for (const f of CHART_CATALOG[chartKey]?.filters ?? []) used.add(f)
  }
  return used
}
