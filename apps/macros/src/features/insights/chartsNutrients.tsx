import { plural } from '@tracker-engine/core'
import type { EChartsOption } from 'echarts'
import { Chart, ChartCard } from '@tracker-engine/ui/charts'
import {
  coverageNote,
  formatAmount,
  nutrientStatus,
  nutrientTargets,
  type ReferenceSex,
} from '@/lib/micronutrients'
import { mgToGrams, type CoveredNutrients } from '@/lib/nutrition'
import { shortDay, useChartTokens } from './chartTokens'
import type { InsightsDay } from './useInsightsData'

/**
 * Micronutrients as a share of their reference intake, over the whole window.
 *
 * Bars rather than a score, for the reason lib/micronutrients spells out: one number over a
 * partly-recorded set of nutrients means nothing. A nutrient nothing recorded is drawn as absent,
 * not as zero.
 */
export function AdequacyChart({
  nutrition,
  dayCount,
  sex,
}: {
  nutrition: CoveredNutrients
  dayCount: number
  sex: ReferenceSex
}) {
  const tokens = useChartTokens()
  const statuses = nutrientStatus(nutrition.totals, sex, nutrition.coverage)
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
          : `Daily average over ${plural(dayCount, 'logged day')}` +
            (unknown > 0 ? ` · ${unknown} too patchily recorded to judge` : '')
      }
      isEmpty={known.length === 0}
      emptyMessage="None of the foods logged carried micronutrient data."
      table={{
        columns: ['Nutrient', 'Average', 'Reference', 'Share'],
        rows: statuses.map((status) => [
          status.label,
          status.verdict === 'unknown' ? coverageNote(status) : formatAmount(status),
          formatAmount({ ...status, amount: status.reference }),
          status.ratio === null ? '—' : `${Math.round(status.ratio * 100)}%`,
        ]),
      }}
    >
      <Chart option={option} ariaLabel="Micronutrient averages as a share of reference intake" />
    </ChartCard>
  )
}

/**
 * Fibre per day against the reference intake.
 *
 * Broken out of the micronutrient bars because it's the one most people can actually act on, and
 * because a day with no fibre *data* has to look different from a day with no fibre — the gaps
 * here are gaps in the database, not in the diet.
 */
export function FiberChart({ days, sex }: { days: InsightsDay[]; sex: ReferenceSex }) {
  const tokens = useChartTokens()
  const reference =
    nutrientTargets(sex).find((target) => target.key === 'fiberMg')?.reference ?? 28_000
  const referenceG = Math.round(mgToGrams(reference))
  // A day whose fibre came from only part of what was eaten is a floor, not a reading, so it is
  // excluded from the mean rather than dragging it down.
  const MIN_COVERAGE = 0.66
  const measured = days.filter((day) => day.fiber !== null && day.fiberCoverage >= MIN_COVERAGE)

  const option: EChartsOption = {
    animation: false,
    grid: { left: 36, right: 12, top: 12, bottom: 24 },
    xAxis: {
      type: 'category',
      data: days.map((day) => shortDay(day.day)),
      axisLine: { lineStyle: { color: tokens.axis } },
      axisLabel: { color: tokens.inkMuted, fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: tokens.gridline } },
      axisLabel: { color: tokens.inkMuted, fontSize: 10, formatter: '{value}g' },
    },
    tooltip: { trigger: 'axis' },
    series: [
      {
        type: 'bar',
        barMaxWidth: 14,
        data: days.map((day) =>
          day.fiber === null
            ? null
            : {
                value: Math.round(day.fiber),
                itemStyle: {
                  color: day.fiber >= referenceG ? tokens.on : tokens.inkMuted,
                  // Hollow when only part of the day reported fibre: the bar is a floor, and a solid
                  // one would claim the day fell short when the database simply didn't say.
                  opacity: day.fiberCoverage >= MIN_COVERAGE ? 1 : 0.4,
                },
              },
        ),
        markLine: {
          silent: true,
          symbol: 'none',
          label: { formatter: `${referenceG}g`, color: tokens.inkMuted, fontSize: 10 },
          lineStyle: { color: tokens.on, type: 'dashed' },
          data: [{ yAxis: referenceG }],
        },
      },
    ],
  }

  return (
    <ChartCard
      title="Fibre"
      subtitle={
        measured.length === 0
          ? undefined
          : `Fully recorded on ${measured.length} of ${days.length} logged days · reference ${referenceG}g`
      }
      isEmpty={measured.length === 0}
      emptyMessage="None of the foods logged carried a fibre figure."
      table={{
        columns: ['Day', 'Fibre (g)'],
        rows: days.map((day) => [
          day.day,
          day.fiber === null
            ? 'not recorded'
            : day.fiberCoverage >= MIN_COVERAGE
              ? Math.round(day.fiber)
              : `${Math.round(day.fiber)}+ (partial)`,
        ]),
      }}
    >
      <Chart option={option} ariaLabel="Fibre per day against the reference intake" />
    </ChartCard>
  )
}
