import type { EChartsOption } from 'echarts'
import { Chart, ChartCard } from '@tracker-engine/ui/charts'
import { Card } from '@tracker-engine/ui'
import { nutrientTargets, type ReferenceSex } from '@/lib/micronutrients'
import { NutrientRows } from '@/features/shared/NutrientRows'
import type { LogEntry } from '@/domain/types'
import { mgToGrams, type CoveredNutrients } from '@/lib/nutrition'
import { shortDay, useChartTokens } from './chartTokens'
import type { InsightsDay } from './useInsightsData'

export function NutrientList(props: {
  nutrition: CoveredNutrients
  entries: readonly LogEntry[]
  dayCount: number
  sex: ReferenceSex
}) {
  return (
    <Card className="p-0">
      <div className="px-4 pb-1 pt-3">
        <h2 className="text-[15px] font-semibold tracking-tight">Nutrients</h2>
        <p className="text-[12px] text-ink-muted">Daily average · tap one to see where it comes from</p>
      </div>
      <NutrientRows {...props} />
    </Card>
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
          : `Daily · reference ${referenceG}g`
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
