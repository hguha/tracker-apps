import type { EChartsOption, LineSeriesOption } from 'echarts'
import { Chart, ChartCard } from '@tracker-engine/ui/charts'
import { WEEK_MS, bodyWeightFromKg, dayKey, dayNoon } from '@tracker-engine/core'
import type { TrendPoint } from '@tracker-engine/body'
import { useUnits } from '@/features/shared/useUnits'
import { arrivalDay, perWeek, timeUntil } from '@/features/shared/goalText'
import type { GoalForecast, RateLine } from '@/lib/goal'
import { shortDay, useChartTokens } from './chartTokens'

const PROJECTION_HORIZON_WEEKS = 26

export function WeightChart({
  trend,
  forecast = null,
  targetKg = null,
  now = Date.now(),
}: {
  trend: readonly TrendPoint[]
  forecast?: GoalForecast | null
  targetKg?: number | null
  now?: number
}) {
  const tokens = useChartTokens()
  const units = useUnits()
  const show = (kg: number) => bodyWeightFromKg(kg, units.weight)
  const latest = trend[trend.length - 1]

  const projection = (line: RateLine | null): [number, number][] => {
    if (!line || !latest || targetKg === null || line.etaAt === null) return []
    const endAt = Math.min(line.etaAt, now + PROJECTION_HORIZON_WEEKS * WEEK_MS)
    const endKg = latest.trendKg + (line.kgPerWeek * (endAt - now)) / WEEK_MS
    return [
      [now, show(latest.trendKg)],
      [endAt, show(endKg)],
    ]
  }
  const likely = projection(forecast?.likely ?? null)
  const onTarget = projection(forecast?.onTarget ?? null)
  const hasProjection = likely.length > 0 || onTarget.length > 0

  const projectedSeries = (
    name: string,
    data: [number, number][],
    color: string,
    type: 'dashed' | 'dotted',
  ): LineSeriesOption => ({
    name,
    type: 'line',
    showSymbol: true,
    symbolSize: (_value: unknown, params: { dataIndex: number }) => (params.dataIndex === 0 ? 0 : 6),
    lineStyle: { color, width: 2, type },
    itemStyle: { color },
    data,
  })

  const option: EChartsOption = {
    animation: false,
    grid: { left: 44, right: 12, top: hasProjection ? 28 : 12, bottom: 24 },
    legend: hasProjection
      ? { textStyle: { color: tokens.inkMuted, fontSize: 10 }, top: 0, itemHeight: 8 }
      : undefined,
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: tokens.axis } },
      axisLabel: {
        color: tokens.inkMuted,
        fontSize: 10,
        hideOverlap: true,
        formatter: (value: number) => shortDay(dayKey(value)),
      },
      splitLine: { show: false },
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
        data: trend.map((p) => [dayNoon(p.day), show(p.kg)]),
      },
      {
        name: 'Trend',
        type: 'line',
        smooth: true,
        showSymbol: false,
        lineStyle: { color: tokens.accent, width: 2.5 },
        itemStyle: { color: tokens.accent },
        data: trend.map((p) => [dayNoon(p.day), show(p.trendKg)]),
        markLine:
          targetKg === null
            ? undefined
            : {
                silent: true,
                symbol: 'none',
                label: {
                  formatter: `Goal ${show(targetKg)}`,
                  color: tokens.inkMuted,
                  fontSize: 10,
                  position: 'insideStartTop',
                },
                lineStyle: { color: tokens.on, type: 'dashed', width: 1 },
                data: [{ yAxis: show(targetKg) }],
              },
      },
      ...(likely.length > 0 ? [projectedSeries('Likely', likely, tokens.accent, 'dashed')] : []),
      ...(onTarget.length > 0
        ? [projectedSeries('On target', onTarget, tokens.inkMuted, 'dotted')]
        : []),
    ],
  }

  return (
    <ChartCard
      title="Weight"
      subtitle={
        hasProjection
          ? `Trend in ${units.weight}, projected to your goal`
          : `Trend in ${units.weight}, with each weigh-in behind it`
      }
      isEmpty={trend.length === 0}
      emptyMessage="No weigh-ins yet."
      table={{
        columns: ['Day', `Weighed (${units.weight})`, `Trend (${units.weight})`],
        rows: trend.map((p) => [p.day, show(p.kg), show(p.trendKg)]),
      }}
    >
      {forecast && targetKg !== null && (
        <GoalStrip forecast={forecast} goal={`${show(targetKg)} ${units.weight}`} unit={units.weight} />
      )}
      <Chart option={option} ariaLabel="Bodyweight, its smoothed trend, and the projection to your goal" />
    </ChartCard>
  )
}

function GoalStrip({
  forecast,
  goal,
  unit,
}: {
  forecast: GoalForecast
  goal: string
  unit: 'kg' | 'lb'
}) {
  const cells: { label: string; value: string; sub: string | null }[] = [
    { label: 'Goal', value: goal, sub: null },
    {
      label: 'Likely',
      value: forecast.likely?.etaAt ? arrivalDay(forecast.likely.etaAt) : '—',
      sub: forecast.likely
        ? [perWeek(forecast.likely.kgPerWeek, unit), forecast.likely.etaAt && timeUntil(forecast.likely.etaAt)]
            .filter(Boolean)
            .join(' · ')
        : null,
    },
    {
      label: 'On target',
      value: forecast.onTarget?.etaAt ? arrivalDay(forecast.onTarget.etaAt) : '—',
      sub: forecast.onTarget ? perWeek(forecast.onTarget.kgPerWeek, unit) : null,
    },
  ]

  return (
    <dl className="mx-2 mb-1 mt-1 grid grid-cols-3 gap-2 rounded-xl bg-sunken px-3 py-2">
      {cells.map((cell) => (
        <div key={cell.label} className="min-w-0">
          <dt className="text-[11px] text-ink-muted">{cell.label}</dt>
          <dd className="tabular truncate text-[14px] font-semibold">{cell.value}</dd>
          {cell.sub && <dd className="tabular truncate text-[11px] text-ink-muted">{cell.sub}</dd>}
        </div>
      ))}
    </dl>
  )
}
