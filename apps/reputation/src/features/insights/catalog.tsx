import type { ReactNode } from 'react'
import type { InsightsData } from './useInsightsData'
import { CardioChart } from './chartsBody'
import {
  EquipmentMixChart,
  PatternCoverageChart,
  RegionShareChart,
  RegionVolumeOverTimeChart,
  SetsByRegionChart,
} from './chartsRegion'
import {
  DayOfWeekChart,
  DurationTrendChart,
  ExerciseVarietyChart,
  GapDistributionChart,
  SetsPerSessionChart,
  TimeOfDayChart,
  VolumeVsDurationChart,
} from './chartsSession'
import {
  PerExerciseVolumeChart,
  RepRangeChart,
  StalledLiftsChart,
  StrengthProgressionChart,
  TopSetChart,
} from './chartsStrength'
import { SummaryCard, WeeklyVolumeChart, WorkoutsPerWeekChart } from './chartsVolume'
import { PrEstimator } from './PrEstimator'

// Range (time) is universal, so it's implicit rather than a FilterKey.
export type FilterKey = 'region' | 'exercise'

export interface ChartContext {
  data: InsightsData
  rangeLabel: string
  activeExerciseId: string | null
}

interface ChartDef {
  filters: FilterKey[]
  render: (ctx: ChartContext) => ReactNode
}

export const CHART_CATALOG = {
  summary: {
    filters: ['region'],
    render: ({ data, rangeLabel }) => <SummaryCard data={data} rangeLabel={rangeLabel} />,
  },
  weeklyVolume: {
    filters: ['region'],
    render: ({ data }) => <WeeklyVolumeChart data={data} />,
  },
  setsByRegion: {
    filters: ['region'],
    render: ({ data }) => <SetsByRegionChart data={data} />,
  },
  regionShare: {
    filters: ['region'],
    render: ({ data }) => <RegionShareChart data={data} />,
  },
  regionVolumeOverTime: {
    filters: ['region'],
    render: ({ data }) => <RegionVolumeOverTimeChart data={data} />,
  },
  patternCoverage: {
    filters: ['region'],
    render: ({ data }) => <PatternCoverageChart data={data} />,
  },
  equipmentMix: {
    filters: ['region'],
    render: ({ data }) => <EquipmentMixChart data={data} />,
  },
  setsPerSession: {
    filters: [],
    render: ({ data }) => <SetsPerSessionChart data={data} />,
  },
  exerciseVariety: {
    filters: ['region'],
    render: ({ data }) => <ExerciseVarietyChart data={data} />,
  },
  volumeVsDuration: {
    filters: [],
    render: ({ data }) => <VolumeVsDurationChart data={data} />,
  },

  prEstimator: {
    filters: ['exercise'],
    render: ({ data }) => <PrEstimator data={data} />,
  },
  strengthProgression: {
    filters: ['exercise'],
    render: ({ data, activeExerciseId }) => (
      <StrengthProgressionChart data={data} activeExerciseId={activeExerciseId} />
    ),
  },
  topSet: {
    filters: ['exercise'],
    render: ({ data, activeExerciseId }) => (
      <TopSetChart data={data} activeExerciseId={activeExerciseId} />
    ),
  },
  perExerciseVolume: {
    filters: ['exercise'],
    render: ({ data, activeExerciseId }) => (
      <PerExerciseVolumeChart data={data} activeExerciseId={activeExerciseId} />
    ),
  },
  // Rep ranges belong under Volume — a distribution across the whole range, scoped
  // by region, not a single-lift strength readout.
  repRange: {
    filters: ['region'],
    render: ({ data }) => <RepRangeChart data={data} />,
  },
  // No region filter: Strength shows only an exercise filter, so this stays an
  // unfiltered overview of every stalled lift.
  stalledLifts: {
    filters: [],
    render: ({ data }) => <StalledLiftsChart data={data} />,
  },

  workoutsPerWeek: {
    filters: [],
    render: ({ data }) => <WorkoutsPerWeekChart data={data} />,
  },
  dayOfWeek: {
    filters: [],
    render: ({ data }) => <DayOfWeekChart data={data} />,
  },
  timeOfDay: {
    filters: [],
    render: ({ data }) => <TimeOfDayChart data={data} />,
  },
  durationTrend: {
    filters: [],
    render: ({ data }) => <DurationTrendChart data={data} />,
  },
  gapDistribution: {
    filters: [],
    render: ({ data }) => <GapDistributionChart data={data} />,
  },
  cardio: {
    filters: [],
    render: ({ data }) => <CardioChart data={data} />,
  },
} satisfies Record<string, ChartDef>

type ChartKey = keyof typeof CHART_CATALOG

export interface SubTab {
  key: string
  label: string
  charts: ChartKey[]
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
    for (const f of CHART_CATALOG[chartKey].filters) used.add(f)
  }
  return used
}
