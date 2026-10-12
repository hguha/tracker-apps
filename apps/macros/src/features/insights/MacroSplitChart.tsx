import type { EChartsOption } from 'echarts'
import { Chart, ChartCard } from '@tracker-engine/ui/charts'
import { categoryAxis, chartLegend, shortDay, useChartTokens, valueAxis } from './chartTokens'
import type { InsightsDay } from './useInsightsData'

/** Where the calories came from, day by day. Stacked grams rather than percentages: grams are
 *  what the targets are set in, so the chart and the target speak the same units. */
export function MacroSplitChart({ days }: { days: InsightsDay[] }) {
  const tokens = useChartTokens()

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
    data: days.map((d) => Math.round(d[key])),
  }))

  const option: EChartsOption = {
    animation: false,
    grid: { left: 40, right: 12, top: 28, bottom: 24 },
    legend: chartLegend(tokens),
    xAxis: categoryAxis(tokens, days.map((d) => shortDay(d.day))),
    yAxis: valueAxis(tokens, { axisLabel: { formatter: '{value}g' } }),
    tooltip: { trigger: 'axis' },
    series,
  }

  return (
    <ChartCard
      title="Macros"
      subtitle="Grams per day"
      isEmpty={days.length === 0}
      emptyMessage="Log a few days to see this."
      table={{
        columns: ['Day', 'Protein', 'Carbs', 'Fat'],
        rows: days.map((d) => [
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
