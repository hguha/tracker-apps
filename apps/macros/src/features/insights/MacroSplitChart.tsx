import type { EChartsOption } from 'echarts'
import { Chart, ChartCard } from '@tracker-engine/ui/charts'
import { shortDay, useChartTokens } from './chartTokens'
import type { DayTotals } from './IntakeChart'

/** Where the calories came from, day by day. Stacked grams rather than percentages: grams are
 *  what the targets are set in, so the chart and the target speak the same units. */
export function MacroSplitChart({ days }: { days: DayTotals[] }) {
  const tokens = useChartTokens()
  const recent = days.slice(-30)

  const series = (
    [
      ['Protein', 'protein', tokens.protein],
      ['Carbs', 'carbs', tokens.carbs],
      ['Fat', 'fat', tokens.fat],
    ] as const
  ).map(([name, key, color]) => ({
    name,
    type: 'bar' as const,
    stack: 'macros',
    barMaxWidth: 14,
    itemStyle: { color },
    data: recent.map((d) => Math.round(d[key])),
  }))

  const option: EChartsOption = {
    animation: false,
    grid: { left: 40, right: 12, top: 28, bottom: 24 },
    legend: { textStyle: { color: tokens.inkMuted, fontSize: 10 }, top: 0, itemHeight: 8 },
    xAxis: {
      type: 'category',
      data: recent.map((d) => shortDay(d.day)),
      axisLine: { lineStyle: { color: tokens.axis } },
      axisLabel: { color: tokens.inkMuted, fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: tokens.gridline } },
      axisLabel: { color: tokens.inkMuted, fontSize: 10, formatter: '{value}g' },
    },
    tooltip: { trigger: 'axis' },
    series,
  }

  return (
    <ChartCard
      title="Macros"
      subtitle="Grams per day"
      isEmpty={recent.length === 0}
      emptyMessage="Log a few days to see this."
      table={{
        columns: ['Day', 'Protein', 'Carbs', 'Fat'],
        rows: recent.map((d) => [
          d.day,
          Math.round(d.protein),
          Math.round(d.carbs),
          Math.round(d.fat),
        ]),
      }}
    >
      <Chart option={option} ariaLabel="Protein, carbohydrate and fat grams per day" />
    </ChartCard>
  )
}
