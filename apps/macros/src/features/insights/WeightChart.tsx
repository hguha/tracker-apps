import type { EChartsOption } from 'echarts'
import { Chart, ChartCard } from '@tracker-engine/ui/charts'
import { bodyWeightFromKg } from '@tracker-engine/core'
import type { TrendPoint } from '@tracker-engine/body'
import { useUnits } from '@/features/shared/useUnits'
import { shortDay, useChartTokens } from './chartTokens'

/**
 * Raw weigh-ins as faint dots, the trend as the line. Deliberate: the trend is what every
 * decision reads, and showing the scale readings equally prominently invites reacting to
 * water weight.
 */
export function WeightChart({ trend }: { trend: readonly TrendPoint[] }) {
  const tokens = useChartTokens()
  const units = useUnits()
  const show = (kg: number) => bodyWeightFromKg(kg, units.weight)

  const option: EChartsOption = {
    animation: false,
    grid: { left: 44, right: 12, top: 12, bottom: 24 },
    xAxis: {
      type: 'category',
      data: trend.map((p) => shortDay(p.day)),
      axisLine: { lineStyle: { color: tokens.axis } },
      axisLabel: { color: tokens.inkMuted, fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      scale: true,
      splitLine: { lineStyle: { color: tokens.gridline } },
      axisLabel: {
        color: tokens.inkMuted,
        fontSize: 10,
        formatter: `{value} ${units.weight}`,
      },
    },
    tooltip: { trigger: 'axis' },
    series: [
      {
        name: 'Weighed',
        type: 'scatter',
        symbolSize: 4,
        itemStyle: { color: tokens.inkMuted, opacity: 0.5 },
        data: trend.map((p) => show(p.kg)),
      },
      {
        name: 'Trend',
        type: 'line',
        smooth: true,
        showSymbol: false,
        lineStyle: { color: tokens.accent, width: 2.5 },
        data: trend.map((p) => show(p.trendKg)),
      },
    ],
  }

  return (
    <ChartCard
      title="Weight"
      subtitle={`Trend in ${units.weight}, with each weigh-in behind it`}
      isEmpty={trend.length === 0}
      emptyMessage="No weigh-ins yet."
      table={{
        columns: ['Day', `Weighed (${units.weight})`, `Trend (${units.weight})`],
        rows: trend.map((p) => [p.day, show(p.kg), show(p.trendKg)]),
      }}
    >
      <Chart option={option} ariaLabel="Bodyweight and its smoothed trend" />
    </ChartCard>
  )
}
