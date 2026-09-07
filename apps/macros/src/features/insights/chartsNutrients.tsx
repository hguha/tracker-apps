import type { EChartsOption } from 'echarts'
import { Chart, ChartCard } from '@tracker-engine/ui/charts'
import { formatAmount, nutrientStatus } from '@/lib/micronutrients'
import { useChartTokens } from './chartTokens'
import type { Nutrients } from '@/domain/types'

/**
 * Micronutrients as a share of their reference intake, over the whole window.
 *
 * Bars rather than a score, for the reason lib/micronutrients spells out: one number over a
 * partly-recorded set of nutrients means nothing. A nutrient nothing recorded is drawn as absent,
 * not as zero.
 */
export function AdequacyChart({
  averages,
  dayCount,
}: {
  averages: Nutrients
  dayCount: number
}) {
  const tokens = useChartTokens()
  const statuses = nutrientStatus(averages)
  const known = statuses.filter((status) => status.verdict !== 'unknown')

  const colorFor = (verdict: string): string =>
    verdict === 'short' ? tokens.inkMuted : verdict === 'over' ? tokens.over : tokens.on

  const option: EChartsOption = {
    animation: false,
    grid: { left: 90, right: 30, top: 8, bottom: 24 },
    xAxis: {
      type: 'value',
      max: 150,
      splitLine: { lineStyle: { color: tokens.gridline } },
      axisLabel: { color: tokens.inkMuted, fontSize: 10, formatter: '{value}%' },
    },
    yAxis: {
      type: 'category',
      data: known.map((status) => status.label).reverse(),
      axisLine: { lineStyle: { color: tokens.axis } },
      axisLabel: { color: tokens.inkMuted, fontSize: 10 },
    },
    tooltip: { trigger: 'axis' },
    series: [
      {
        type: 'bar',
        barMaxWidth: 14,
        data: known
          .map((status) => ({
            value: Math.min(150, Math.round((status.ratio ?? 0) * 100)),
            itemStyle: { color: colorFor(status.verdict) },
          }))
          .reverse(),
        markLine: {
          silent: true,
          symbol: 'none',
          label: { formatter: 'reference', color: tokens.inkMuted, fontSize: 9 },
          lineStyle: { color: tokens.inkMuted, type: 'dashed' },
          data: [{ xAxis: 100 }],
        },
      },
    ],
  }

  const unknown = statuses.length - known.length

  return (
    <ChartCard
      title="Micronutrients"
      subtitle={
        known.length === 0
          ? undefined
          : `Daily average over ${dayCount} logged day${dayCount === 1 ? '' : 's'}` +
            (unknown > 0 ? ` · ${unknown} not recorded` : '')
      }
      isEmpty={known.length === 0}
      emptyMessage="None of the foods logged carried micronutrient data."
      table={{
        columns: ['Nutrient', 'Average', 'Reference', 'Share'],
        rows: statuses.map((status) => [
          status.label,
          status.verdict === 'unknown' ? 'not recorded' : formatAmount(status),
          formatAmount({ ...status, amount: status.reference }),
          status.ratio === null ? '—' : `${Math.round(status.ratio * 100)}%`,
        ]),
      }}
    >
      <Chart option={option} ariaLabel="Micronutrient averages as a share of reference intake" />
    </ChartCard>
  )
}
