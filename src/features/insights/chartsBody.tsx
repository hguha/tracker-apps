import { bodyWeightFromKg, distanceFromM, formatDuration } from '@/lib/units'
import { Chart } from './Chart'
import { ChartCard } from './ChartCard'
import { baseOption, categoryAxis, chrome, valueAxis } from './chartTheme'
import { type InsightsData } from './useInsightsData'
import { useAppearanceKey } from '@/lib/useColorScheme'
import { format } from 'date-fns'
import { type EChartsOption } from 'echarts'
import { useMemo } from 'react'

export function BodyweightChart({ data }: { data: InsightsData }) {
  const appearance = useAppearanceKey()
  const unit = data.profile.unitWeight
  const entries = data.bodyMetrics.get('bodyweight') ?? []

  const { option, labels, raw, average } = useMemo(() => {
    const raw = entries.map((e) => bodyWeightFromKg(e.value, unit))
    const average = raw.map((_, index) => {
      const window = raw.slice(Math.max(0, index - 6), index + 1)
      return Number((window.reduce((a, b) => a + b, 0) / window.length).toFixed(1))
    })
    const labels = entries.map((e) => format(e.at, 'MMM d'))
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
      yAxis: { ...valueAxis(c), scale: true },
      series: [
        {
          name: 'Daily',
          type: 'line',
          data: raw,
          symbol: 'circle',
          symbolSize: 4,
          lineStyle: { width: 0 },
          itemStyle: { color: c.muted },
        },
        {
          name: '7-day average',
          type: 'line',
          data: average,
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2.5, color: c.plot },
        },
      ],
    }
    return { option, labels, raw, average }
  }, [entries, unit, appearance])

  return (
    <ChartCard
      title="Bodyweight"
      subtitle={`Daily readings and the 7-day trend, in ${unit}`}
      isEmpty={entries.length < 2}
      emptyMessage="Log your weight twice to see a trend."
      table={{
        columns: ['Date', unit, '7-day avg'],
        rows: labels
          .map((label, index) => [label, raw[index]!, average[index]!])
          .reverse(),
      }}
    >
      <Chart option={option} ariaLabel="Line chart of bodyweight over time" />
    </ChartCard>
  )
}

// D-41

/**
 * Cardio time and distance as **two separate charts**, never two y-axes — the
 * alignment of two scales on one plot invents a correlation that isn't there.
 */

export function CardioChart({ data }: { data: InsightsData }) {
  const unit = data.profile.unitDistance
  const hasCardio = data.cardioSeconds > 0 || data.cardioMeters > 0

  const totalDistance = distanceFromM(data.cardioMeters, unit)

  return (
    <ChartCard
      title="Cardio"
      subtitle="Kept separate from lifting volume"
      isEmpty={!hasCardio}
      emptyMessage="Log a run, ride, or row to see cardio totals."
      table={{
        columns: ['Measure', 'Total'],
        rows: [
          ['Time', formatDuration(data.cardioSeconds)],
          ['Distance', `${totalDistance.toFixed(2)} ${unit}`],
        ],
      }}
    >
      <div className="grid grid-cols-2 gap-2 px-2 py-3">
        <div className="rounded-xl border border-line bg-sunken px-3.5 py-2.5">
          <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">
            Total time
          </p>
          <p className="mt-0.5 text-[21px] font-bold leading-tight">
            {formatDuration(data.cardioSeconds)}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-sunken px-3.5 py-2.5">
          <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">
            Total distance
          </p>
          <p className="mt-0.5 text-[21px] font-bold leading-tight">
            {totalDistance.toFixed(1)}
            <span className="ml-1 text-[13px] font-semibold text-ink-muted">{unit}</span>
          </p>
        </div>
      </div>
    </ChartCard>
  )
}

// D-37
