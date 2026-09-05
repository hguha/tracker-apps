import type { EChartsOption } from 'echarts'
import { Chart, ChartCard } from '@tracker-engine/ui/charts'
import { shortDay, useChartTokens } from './chartTokens'

export interface DayTotals {
  day: string
  kcal: number
  protein: number
  carbs: number
  fat: number
}

/** Calories per day against the target line — the one chart that answers "am I on plan?". */
export function IntakeChart({
  days,
  targetKcal,
}: {
  days: DayTotals[]
  targetKcal: number | null
}) {
  const tokens = useChartTokens()
  const recent = days.slice(-30)

  const option: EChartsOption = {
    animation: false,
    grid: { left: 44, right: 12, top: 12, bottom: 24 },
    xAxis: {
      type: 'category',
      data: recent.map((d) => shortDay(d.day)),
      axisLine: { lineStyle: { color: tokens.axis } },
      axisLabel: { color: tokens.inkMuted, fontSize: 10, interval: 'auto' },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: tokens.gridline } },
      axisLabel: { color: tokens.inkMuted, fontSize: 10 },
    },
    tooltip: { trigger: 'axis' },
    series: [
      {
        type: 'bar',
        data: recent.map((d) => ({
          value: d.kcal,
          // Colour by side of target rather than a legend: the question is only ever
          // over or under.
          itemStyle: {
            color: targetKcal !== null && d.kcal > targetKcal ? tokens.over : tokens.accent,
          },
        })),
        barMaxWidth: 14,
        ...(targetKcal !== null && {
          markLine: {
            silent: true,
            symbol: 'none',
            label: { formatter: 'target', color: tokens.inkMuted, fontSize: 10 },
            lineStyle: { color: tokens.on, type: 'dashed' },
            data: [{ yAxis: targetKcal }],
          },
        }),
      },
    ],
  }

  return (
    <ChartCard
      title="Calories"
      subtitle={targetKcal === null ? 'Last 30 days' : `Last 30 days vs ${targetKcal} kcal`}
      isEmpty={recent.length === 0}
      emptyMessage="Log a few days to see this."
      table={{
        columns: ['Day', 'kcal'],
        rows: recent.map((d) => [d.day, d.kcal]),
      }}
    >
      <Chart option={option} ariaLabel="Calories per day against target" />
    </ChartCard>
  )
}
