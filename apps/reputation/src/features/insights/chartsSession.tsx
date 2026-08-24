import { displayWeight } from '@/lib/units'
import { Chart } from './Chart'
import { ChartCard } from './ChartCard'
import { baseOption, categoryAxis, chrome, valueAxis } from './chartTheme'
import { type InsightsData } from './useInsightsData'
import { weekKey } from '@/lib/dates'
import { useAppearanceKey } from '@/lib/useColorScheme'
import { format } from 'date-fns'
import { type EChartsOption } from 'echarts'
import { useMemo } from 'react'
import {
  DAY_LABELS,
  movingAverage,
  SET_COUNT_BUCKETS,
  formatHour,
  weekLabels,
} from './chartShared'
import { sessionGapsDays } from '@/data/patterns'

export function DayOfWeekChart({ data }: { data: InsightsData }) {
  const appearance = useAppearanceKey()

  const { option, labels, counts } = useMemo(() => {
    const order = Array.from({ length: 7 }, (_, i) => (i + data.profile.weekStartsOn) % 7)
    const labels = order.map((day) => DAY_LABELS[day]!)
    const counts = order.map((day) => data.dayOfWeekCounts[day]!)
    const c = chrome()
    const option: EChartsOption = {
      ...baseOption(c),
      xAxis: categoryAxis(c, labels),
      yAxis: valueAxis(c, { name: 'workouts' }),
      series: [
        {
          type: 'bar',
          data: counts,
          barMaxWidth: 32,
          itemStyle: { color: c.plot, borderRadius: [4, 4, 0, 0] },
        },
      ],
    }
    return { option, labels, counts }
  }, [data, appearance])

  return (
    <ChartCard
      title="Which days you train"
      subtitle="Sessions by day of week"
      isEmpty={data.workoutCount === 0}
      emptyMessage="Log a few workouts to see your weekly pattern."
      table={{
        columns: ['Day', 'Workouts'],
        rows: labels.map((label, index) => [label, counts[index]!]),
      }}
    >
      <Chart option={option} ariaLabel="Bar chart of workouts by day of week" />
    </ChartCard>
  )
}

// C-31

export function VolumeVsDurationChart({ data }: { data: InsightsData }) {
  const appearance = useAppearanceKey()
  const unit = data.profile.unitWeight

  const { option, points } = useMemo(() => {
    const points = data.sessions
      .filter((s) => s.durationSeconds !== null && s.volumeKg > 0)
      .map((s) => [
        Math.round(s.durationSeconds! / 60),
        displayWeight(s.volumeKg, unit),
        s.at,
      ])
    const c = chrome()
    const option: EChartsOption = {
      ...baseOption(c),
      tooltip: {
        ...baseOption(c).tooltip,
        trigger: 'item',
        formatter: (params: unknown) => {
          const point = params as { value: [number, number, number] }
          return `${format(point.value[2], 'MMM d')}<br/>${point.value[0]} min · ${point.value[1].toLocaleString()} ${unit}`
        },
      },
      xAxis: valueAxis(c, { name: 'minutes' }),
      yAxis: valueAxis(c, { name: unit }),
      series: [
        {
          type: 'scatter',
          data: points,
          symbolSize: 9,
          itemStyle: { color: c.plot, borderColor: c.surface, borderWidth: 2 },
        },
      ],
    }
    return { option, points }
  }, [data, unit, appearance])

  return (
    <ChartCard
      title="Volume vs duration"
      subtitle="Denser sessions, or just longer ones?"
      isEmpty={points.length < 3}
      emptyMessage="Three finished workouts will show whether longer means more work."
      table={{
        columns: ['Date', 'Minutes', `Volume (${unit})`],
        rows: [...points]
          .reverse()
          .map((p) => [format(p[2]!, 'MMM d'), p[0]!, p[1]!.toLocaleString()]),
      }}
    >
      <Chart
        option={option}
        ariaLabel="Scatter plot of session volume against duration"
      />
    </ChartCard>
  )
}

// E-42

export function TimeOfDayChart({ data }: { data: InsightsData }) {
  const appearance = useAppearanceKey()

  const option = useMemo<EChartsOption>(() => {
    const labels = data.hourCounts.map((_, h) => (h % 3 === 0 ? formatHour(h) : ''))
    const c = chrome()
    return {
      ...baseOption(c),
      tooltip: { ...baseOption(c).tooltip, trigger: 'item' },
      xAxis: categoryAxis(c, labels),
      yAxis: valueAxis(c, { name: 'workouts' }),
      series: [
        {
          type: 'bar',
          data: data.hourCounts,
          barMaxWidth: 14,
          itemStyle: { color: c.plot, borderRadius: [3, 3, 0, 0] },
        },
      ],
    }
  }, [data.hourCounts, appearance])

  return (
    <ChartCard
      title="Time of day"
      subtitle="When your sessions start"
      isEmpty={data.workoutCount === 0}
      emptyMessage="Log a few workouts to see when you train."
      table={{
        columns: ['Hour', 'Workouts'],
        rows: data.hourCounts
          .map((count, hour) => [formatHour(hour), count] as [string, number])
          .filter(([, count]) => count > 0),
      }}
    >
      <Chart option={option} ariaLabel="Histogram of session start times over 24 hours" />
    </ChartCard>
  )
}

// D-40

export function DurationTrendChart({ data }: { data: InsightsData }) {
  const appearance = useAppearanceKey()

  const { option, labels, minutes, average, withDuration } = useMemo(() => {
    const withDuration = data.sessions.filter((s) => s.durationSeconds !== null)
    const labels = withDuration.map((s) => format(s.at, 'MMM d'))
    const minutes = withDuration.map((s) => Math.round(s.durationSeconds! / 60))
    const average = movingAverage(minutes)
    const c = chrome()
    const option: EChartsOption = {
      ...baseOption(c),
      legend: {
        show: true,
        bottom: 0,
        itemWidth: 12,
        itemHeight: 2,
        textStyle: { color: c.muted, fontSize: 11 },
      },
      grid: { left: 8, right: 12, top: 12, bottom: 28, containLabel: true },
      xAxis: categoryAxis(c, labels),
      yAxis: valueAxis(c, { name: 'min' }),
      series: [
        {
          name: 'Duration',
          type: 'line',
          data: minutes,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { width: 2, color: c.plot },
          itemStyle: { color: c.plot },
        },
        {
          name: '4-session average',
          type: 'line',
          data: average,
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, color: c.muted },
        },
      ],
    }
    return { option, labels, minutes, average, withDuration }
  }, [data, appearance])

  return (
    <ChartCard
      title="Workout duration"
      subtitle="Are sessions getting longer?"
      isEmpty={withDuration.length < 2}
      emptyMessage="Finish two workouts to see how long they run."
      table={{
        columns: ['Date', 'Minutes', '4-session avg'],
        rows: labels
          .map(
            (label, i) => [label, minutes[i]!, average[i]!] as [string, number, number],
          )
          .reverse(),
      }}
    >
      <Chart option={option} ariaLabel="Line chart of workout duration over time" />
    </ChartCard>
  )
}

// C-30
/** Ranges of 5, so the histogram stays readable. */

export function SetsPerSessionChart({ data }: { data: InsightsData }) {
  const appearance = useAppearanceKey()

  const { option, tally, counts } = useMemo(() => {
    const counts = data.sessions.map((s) => s.setCount).filter((n) => n > 0)
    const tally = new Array<number>(SET_COUNT_BUCKETS.length).fill(0)
    for (const count of counts) {
      const index = Math.min(SET_COUNT_BUCKETS.length - 1, Math.floor((count - 1) / 5))
      tally[index]! += 1
    }
    const c = chrome()
    const option: EChartsOption = {
      ...baseOption(c),
      tooltip: { ...baseOption(c).tooltip, trigger: 'item' },
      xAxis: categoryAxis(c, SET_COUNT_BUCKETS),
      yAxis: valueAxis(c, { name: 'sessions' }),
      series: [
        {
          type: 'bar',
          data: tally,
          barMaxWidth: 40,
          itemStyle: { color: c.plot, borderRadius: [4, 4, 0, 0] },
        },
      ],
    }
    return { option, tally, counts }
  }, [data, appearance])

  return (
    <ChartCard
      title="Sets per session"
      subtitle="How much work per workout"
      isEmpty={counts.length < 2}
      emptyMessage="Log a couple of sessions to see the spread."
      table={{
        columns: ['Sets', 'Sessions'],
        rows: SET_COUNT_BUCKETS.map((bucket, i) => [bucket, tally[i]!]),
      }}
    >
      <Chart option={option} ariaLabel="Histogram of working sets per session" />
    </ChartCard>
  )
}

// C-33

export function ExerciseVarietyChart({ data }: { data: InsightsData }) {
  const appearance = useAppearanceKey()

  const { option, labels, counts } = useMemo(() => {
    const labels = weekLabels(data.weeks)
    // Recompute distinct exercises per week from the exercise series points.
    const distinctByWeek = new Map<string, Set<string>>()
    for (const series of data.exerciseSeries) {
      for (const point of series.points) {
        const week = weekKey(point.at, data.profile.weekStartsOn)
        const set = distinctByWeek.get(week) ?? new Set<string>()
        set.add(series.exerciseId)
        distinctByWeek.set(week, set)
      }
    }
    const counts = data.weeks.map((week) => distinctByWeek.get(week)?.size ?? 0)
    const c = chrome()
    const option: EChartsOption = {
      ...baseOption(c),
      xAxis: categoryAxis(c, labels),
      yAxis: valueAxis(c, { name: 'lifts' }),
      series: [
        {
          type: 'line',
          data: counts,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { width: 2, color: c.plot },
          itemStyle: { color: c.plot },
        },
      ],
    }
    return { option, labels, counts }
  }, [data, appearance])

  return (
    <ChartCard
      title="Exercise variety"
      subtitle="Distinct lifts each week"
      isEmpty={data.weeks.length < 2}
      emptyMessage="Two weeks of history will show how varied your training is."
      table={{
        columns: ['Week', 'Distinct lifts'],
        rows: labels.map((label, i) => [label, counts[i]!]),
      }}
    >
      <Chart
        option={option}
        ariaLabel="Line chart of distinct exercises trained per week"
      />
    </ChartCard>
  )
}

// B-17

export function GapDistributionChart({ data }: { data: InsightsData }) {
  const appearance = useAppearanceKey()
  const buckets = ['0-1', '2', '3', '4-6', '7+']

  const { option, tally, gaps } = useMemo(() => {
    const gaps = sessionGapsDays(data.sessions.map((s) => s.at))
    const tally = new Array<number>(SET_COUNT_BUCKETS.length).fill(0)
    for (const g of gaps) {
      const i = g <= 1 ? 0 : g === 2 ? 1 : g === 3 ? 2 : g <= 6 ? 3 : 4
      tally[i]! += 1
    }
    const c = chrome()
    const option: EChartsOption = {
      ...baseOption(c),
      tooltip: { ...baseOption(c).tooltip, trigger: 'item' },
      xAxis: categoryAxis(c, buckets),
      yAxis: valueAxis(c, { name: 'gaps' }),
      series: [
        {
          type: 'bar',
          data: tally,
          barMaxWidth: 40,
          itemStyle: { color: c.plot, borderRadius: [4, 4, 0, 0] },
        },
      ],
    }
    return { option, tally, gaps }
  }, [data, appearance])

  return (
    <ChartCard
      title="Gaps between sessions"
      subtitle="Days off between workouts"
      isEmpty={gaps.length < 2}
      emptyMessage="Log a few sessions to see how long your breaks run."
      table={{
        columns: ['Days off', 'Times'],
        rows: buckets.map((b, i) => [b, tally[i]!]),
      }}
    >
      <Chart option={option} ariaLabel="Histogram of days between sessions" />
    </ChartCard>
  )
}

// B-16
/**
 * Lifts whose estimated 1RM hasn't improved recently — what needs attention.
 * A table, not a chart: the useful output is a ranked list with numbers (§9).
 */
