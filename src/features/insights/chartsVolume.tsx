import { displayWeight, formatDuration } from '@/lib/units'
import { Chart } from './Chart'
import { ChartCard } from './ChartCard'
import { baseOption, categoryAxis, chrome, valueAxis } from './chartTheme'
import { type InsightsData } from './useInsightsData'
import { Card } from '@/components/Card'
import { useAppearanceKey } from '@/lib/useColorScheme'
import { type EChartsOption } from 'echarts'
import { useMemo } from 'react'
import { movingAverage as movingAvg, SummaryStat, weekLabels } from './chartShared'

export function WeeklyVolumeChart({ data }: { data: InsightsData }) {
  const appearance = useAppearanceKey()
  const unit = data.profile.unitWeight

  // `appearance` is a dep because chrome() reads the theme.
  const { option, labels, points, movingAverage } = useMemo(() => {
    const labels = weekLabels(data.weeks)
    const points = data.weeks.map((week) =>
      displayWeight(data.volumeByWeek.get(week) ?? 0, unit),
    )
    const movingAverage = movingAvg(points)
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
      yAxis: valueAxis(c),
      series: [
        {
          name: `Volume (${unit})`,
          type: 'line',
          data: points,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { width: 2, color: c.plot },
          itemStyle: { color: c.plot },
        },
        {
          name: '4-week average',
          type: 'line',
          data: movingAverage,
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, color: c.muted },
        },
      ],
    }
    return { option, labels, points, movingAverage }
  }, [data, unit, appearance])

  return (
    <ChartCard
      title="Volume per week"
      subtitle={`Total load lifted, in ${unit}`}
      isEmpty={data.weeks.length < 2}
      emptyMessage="Log workouts in two different weeks to see a trend."
      table={{
        columns: ['Week', `Volume (${unit})`, '4-wk avg'],
        rows: labels.map((label, index) => [
          label,
          points[index]!.toLocaleString(),
          movingAverage[index]!.toLocaleString(),
        ]),
      }}
    >
      <Chart option={option} ariaLabel="Line chart of total training volume per week" />
    </ChartCard>
  )
}

// C-20

export function WorkoutsPerWeekChart({ data }: { data: InsightsData }) {
  const appearance = useAppearanceKey()

  const { option, labels, counts } = useMemo(() => {
    const labels = weekLabels(data.weeks)
    const counts = data.weeks.map((week) => data.workoutsByWeek.get(week) ?? 0)
    const c = chrome()
    const option: EChartsOption = {
      ...baseOption(c),
      xAxis: categoryAxis(c, labels),
      yAxis: valueAxis(c, { name: 'workouts' }),
      series: [
        {
          type: 'bar',
          data: counts,
          barMaxWidth: 28,
          itemStyle: { color: c.plot, borderRadius: [4, 4, 0, 0] },
        },
      ],
    }
    return { option, labels, counts }
  }, [data, appearance])

  return (
    <ChartCard
      title="Workouts per week"
      subtitle="Are you holding the habit?"
      isEmpty={data.weeks.length < 2}
      emptyMessage="Two weeks of history will show your consistency."
      table={{
        columns: ['Week', 'Workouts'],
        rows: labels.map((label, index) => [label, counts[index]!]),
      }}
    >
      <Chart option={option} ariaLabel="Bar chart of workouts per week" />
    </ChartCard>
  )
}

// D-35

export function SummaryCard({
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
        {/* "All time" isn't a duration, so it can't take a "Last" prefix. */}
        {rangeLabel === 'All time' ? 'All time' : `Last ${rangeLabel.toLowerCase()}`}
      </p>
      <p className="mt-1 text-[36px] font-bold leading-none tracking-tight">
        {displayWeight(data.totalVolumeKg, unit).toLocaleString()}
        <span className="ml-1.5 text-[15px] font-semibold text-ink-muted">
          {unit} lifted
        </span>
      </p>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
        <SummaryStat label="Workouts" value={String(data.workoutCount)} />
        <SummaryStat label="Sets" value={String(data.totalSets)} />
        {data.cardioSeconds > 0 && (
          <SummaryStat label="Cardio" value={formatDuration(data.cardioSeconds)} />
        )}
      </div>
    </Card>
  )
}
