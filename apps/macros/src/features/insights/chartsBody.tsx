import type { EChartsOption } from 'echarts'
import type { TrendPoint } from '@tracker-engine/body'
import { Chart, ChartCard } from '@tracker-engine/ui/charts'
import { convertWeight } from '@tracker-engine/core'
import { useUnits } from '@/features/shared/useUnits'
import { shortDay, useChartTokens } from './chartTokens'
import type { ExpenditureWindow } from '@/lib/expenditure'
import type { InsightsDay } from './useInsightsData'

/**
 * Measured expenditure, week by week, with the intake that measured it.
 *
 * The point of the app in one chart: if the line drifts down while intake holds, that's
 * adaptation, and it's why a formula-based target goes stale.
 */
export function ExpenditureChart({ windows }: { windows: ExpenditureWindow[] }) {
  const tokens = useChartTokens()

  const option: EChartsOption = {
    animation: false,
    grid: { left: 48, right: 12, top: 28, bottom: 24 },
    legend: { textStyle: { color: tokens.inkMuted, fontSize: 10 }, top: 0, itemHeight: 8 },
    xAxis: {
      type: 'category',
      data: windows.map((window) => shortDay(window.weekStart)),
      axisLine: { lineStyle: { color: tokens.axis } },
      axisLabel: { color: tokens.inkMuted, fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      scale: true,
      splitLine: { lineStyle: { color: tokens.gridline } },
      axisLabel: { color: tokens.inkMuted, fontSize: 10 },
    },
    tooltip: { trigger: 'axis' },
    series: [
      {
        name: 'Intake',
        type: 'bar',
        barMaxWidth: 22,
        itemStyle: { color: tokens.accent, opacity: 0.35 },
        data: windows.map((window) => Math.round(window.meanIntakeKcal)),
      },
      {
        name: 'Expenditure',
        type: 'line',
        smooth: true,
        symbolSize: 5,
        lineStyle: { color: tokens.accent, width: 2.5 },
        itemStyle: { color: tokens.accent },
        data: windows.map((window) => Math.round(window.estimateKcal)),
      },
    ],
  }

  return (
    <ChartCard
      title="Expenditure by week"
      subtitle="Each week's own estimate, before smoothing"
      isEmpty={windows.length === 0}
      emptyMessage="Needs a week with 4 days logged and 3 weigh-ins."
      table={{
        columns: ['Week', 'Intake', 'Expenditure', 'Days'],
        rows: windows.map((window) => [
          window.weekStart,
          Math.round(window.meanIntakeKcal),
          Math.round(window.estimateKcal),
          window.daysLogged,
        ]),
      }}
    >
      <Chart option={option} ariaLabel="Weekly expenditure estimates against mean intake" />
    </ChartCard>
  )
}

/**
 * Cumulative energy balance against the weight the scale actually reported.
 *
 * A cross-check the user can read: if the two disagree badly, the logging is incomplete or the
 * scale is lying, and it's better to show that than to average it into a confident number.
 */
export function BalanceChart({
  days,
  trend,
  expenditureKcal,
  energyPerKg,
}: {
  days: InsightsDay[]
  trend: readonly TrendPoint[]
  expenditureKcal: number | null
  energyPerKg: number
}) {
  const tokens = useChartTokens()
  const units = useUnits()
  const canDraw = expenditureKcal !== null && days.length > 0 && trend.length > 1

  const trendByDay = new Map(trend.map((point) => [point.day, point.trendKg]))
  const startKg = trend[0]?.trendKg ?? 0

  let cumulative = 0
  const rows = days.map((day) => {
    cumulative += day.kcal - (expenditureKcal ?? 0)
    const trendKg = trendByDay.get(day.day)
    return {
      day: day.day,
      impliedKg: cumulative / energyPerKg,
      actualKg: trendKg === undefined ? null : trendKg - startKg,
    }
  })

  const option: EChartsOption = {
    animation: false,
    grid: { left: 44, right: 12, top: 28, bottom: 24 },
    legend: { textStyle: { color: tokens.inkMuted, fontSize: 10 }, top: 0, itemHeight: 8 },
    xAxis: {
      type: 'category',
      data: rows.map((row) => shortDay(row.day)),
      axisLine: { lineStyle: { color: tokens.axis } },
      axisLabel: { color: tokens.inkMuted, fontSize: 10 },
    },
    yAxis: {
      type: 'value',
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
        name: 'From what you logged',
        type: 'line',
        showSymbol: false,
        lineStyle: { color: tokens.inkMuted, width: 2, type: 'dashed' },
        data: rows.map((row) => round2(convertWeight(row.impliedKg, units.weight))),
      },
      {
        name: 'From the scale',
        type: 'line',
        showSymbol: false,
        connectNulls: true,
        lineStyle: { color: tokens.accent, width: 2.5 },
        data: rows.map((row) =>
          row.actualKg === null ? null : round2(convertWeight(row.actualKg, units.weight)),
        ),
      },
    ],
  }

  return (
    <ChartCard
      title="Logged vs measured change"
      subtitle="Where your log says you should be, against where the scale says you are"
      isEmpty={!canDraw}
      emptyMessage="Needs a measured expenditure and a couple of weeks of weigh-ins."
      table={{
        columns: ['Day', `Implied (${units.weight})`, `Trend (${units.weight})`],
        rows: rows.map((row) => [
          row.day,
          round2(convertWeight(row.impliedKg, units.weight)),
          row.actualKg === null ? '—' : round2(convertWeight(row.actualKg, units.weight)),
        ]),
      }}
    >
      <Chart option={option} ariaLabel="Cumulative energy balance against measured weight change" />
    </ChartCard>
  )
}

/** A weight *change*, so the unrounded conversion — a delta must not snap to a plate increment. */
const round2 = (value: number): number => Number(value.toFixed(2))
