import type { EChartsOption } from 'echarts'
import { Chart, ChartCard } from '@tracker-engine/ui/charts'
import { shortDay, useChartTokens } from './chartTokens'
import type { InsightsDay } from './useInsightsData'

/**
 * Calories per day against the target line — the one chart that answers "am I on plan?".
 *
 * The target is a *series*, not one horizontal line: it changes at each check-in, and drawing
 * today's number across the whole window would mark days as failures against a target that
 * didn't exist then.
 */
export function IntakeChart({ days }: { days: InsightsDay[] }) {
  const tokens = useChartTokens()
  const recent = days
  const latestTarget = [...recent].reverse().find((day) => day.targetKcal !== null)?.targetKcal ?? null

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
          // Colour by side of that day's target rather than a legend: the question is only ever
          // over or under.
          itemStyle: {
            color: d.targetKcal !== null && d.kcal > d.targetKcal ? tokens.over : tokens.accent,
          },
        })),
        barMaxWidth: 14,
      },
      {
        name: 'Target',
        type: 'line',
        step: 'middle',
        showSymbol: false,
        connectNulls: false,
        lineStyle: { color: tokens.on, type: 'dashed', width: 1.5 },
        data: recent.map((d) => d.targetKcal),
      },
    ],
  }

  return (
    <ChartCard
      title="Calories"
      subtitle={
        latestTarget === null
          ? 'Each logged day'
          : `Against the target in force each day — now ${latestTarget} kcal`
      }
      isEmpty={recent.length === 0}
      emptyMessage="Log a few days to see this."
      table={{
        columns: ['Day', 'kcal', 'Target'],
        rows: recent.map((d) => [d.day, d.kcal, d.targetKcal ?? '—']),
      }}
    >
      <Chart option={option} ariaLabel="Calories per day against target" />
    </ChartCard>
  )
}
