import type { EChartsOption } from 'echarts'
import { Chart, ChartCard } from '@tracker-engine/ui/charts'
import { formatClock } from '@/lib/mealTiming'
import { shortDay, useChartTokens } from './chartTokens'
import type { EatingWindow } from '@/domain/types'
import type { InsightsDay } from './useInsightsData'

/**
 * When the calories land.
 *
 * The question the four-meal-box layout can't answer: whether a day is one big evening meal or
 * spread across five, and whether that has moved. Shown against the eating window when there is
 * one, since food outside it is the thing that person actually wants to see.
 */
export function MealTimingChart({
  kcalByHour,
  window,
}: {
  kcalByHour: number[]
  window: EatingWindow | null
}) {
  const tokens = useChartTokens()
  const total = kcalByHour.reduce((sum, value) => sum + value, 0)

  const option: EChartsOption = {
    animation: false,
    grid: { left: 44, right: 12, top: 12, bottom: 24 },
    xAxis: {
      type: 'category',
      data: kcalByHour.map((_, hour) => `${String(hour).padStart(2, '0')}`),
      axisLine: { lineStyle: { color: tokens.axis } },
      axisLabel: { color: tokens.inkMuted, fontSize: 9, interval: 2 },
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
        barMaxWidth: 14,
        data: kcalByHour.map((value, hour) => ({
          value: Math.round(value),
          itemStyle: {
            color:
              window === null || isInsideWindow(hour, window) ? tokens.accent : tokens.over,
          },
        })),
      },
    ],
  }

  const outside =
    window === null
      ? 0
      : kcalByHour.reduce(
          (sum, value, hour) => (isInsideWindow(hour, window) ? sum : sum + value),
          0,
        )

  return (
    <ChartCard
      title="When you eat"
      subtitle={
        window === null
          ? 'Calories by hour, across the window'
          : `${formatClock(window.startMinute)}–${formatClock(window.endMinute)} window · ${Math.round(
              total === 0 ? 0 : (outside / total) * 100,
            )}% eaten outside it`
      }
      isEmpty={total === 0}
      emptyMessage="Log a few meals to see this."
      table={{
        columns: ['Hour', 'kcal'],
        rows: kcalByHour.map((value, hour) => [`${hour}:00`, Math.round(value)]),
      }}
    >
      <Chart option={option} ariaLabel="Calories by hour of the day" />
    </ChartCard>
  )
}

/**
 * Whether the log is complete enough to trust, and how the eating span moves.
 *
 * Both series answer "can the expenditure estimate believe this week": a week of four logged days
 * is the floor, and a span that collapses to two hours usually means only dinner got logged.
 */
export function ConsistencyChart({ days }: { days: InsightsDay[] }) {
  const tokens = useChartTokens()

  const option: EChartsOption = {
    animation: false,
    grid: { left: 40, right: 40, top: 28, bottom: 24 },
    legend: { textStyle: { color: tokens.inkMuted, fontSize: 10 }, top: 0, itemHeight: 8 },
    xAxis: {
      type: 'category',
      data: days.map((day) => shortDay(day.day)),
      axisLine: { lineStyle: { color: tokens.axis } },
      axisLabel: { color: tokens.inkMuted, fontSize: 10 },
    },
    yAxis: [
      {
        type: 'value',
        name: 'meals',
        nameTextStyle: { color: tokens.inkMuted, fontSize: 9 },
        minInterval: 1,
        splitLine: { lineStyle: { color: tokens.gridline } },
        axisLabel: { color: tokens.inkMuted, fontSize: 10 },
      },
      {
        type: 'value',
        name: 'span (h)',
        nameTextStyle: { color: tokens.inkMuted, fontSize: 9 },
        splitLine: { show: false },
        axisLabel: { color: tokens.inkMuted, fontSize: 10 },
      },
    ],
    tooltip: { trigger: 'axis' },
    series: [
      {
        name: 'Eating occasions',
        type: 'bar',
        barMaxWidth: 14,
        itemStyle: { color: tokens.accent },
        data: days.map((day) => day.occasions),
      },
      {
        name: 'First to last',
        type: 'line',
        yAxisIndex: 1,
        showSymbol: false,
        connectNulls: true,
        lineStyle: { color: tokens.carbs, width: 2 },
        data: days.map((day) =>
          day.firstMinute === null || day.lastMinute === null
            ? null
            : Number(((day.lastMinute - day.firstMinute) / 60).toFixed(1)),
        ),
      },
    ],
  }

  const average =
    days.length === 0
      ? 0
      : Math.round((days.reduce((sum, day) => sum + day.occasions, 0) / days.length) * 10) / 10

  return (
    <ChartCard
      title="Meals per day"
      subtitle={days.length === 0 ? undefined : `${average} eating occasions a day on average`}
      isEmpty={days.length === 0}
      emptyMessage="Log a few days to see this."
      table={{
        columns: ['Day', 'Occasions', 'First', 'Last'],
        rows: days.map((day) => [
          day.day,
          day.occasions,
          day.firstMinute === null ? '—' : formatClock(day.firstMinute),
          day.lastMinute === null ? '—' : formatClock(day.lastMinute),
        ]),
      }}
    >
      <Chart option={option} ariaLabel="Eating occasions per day and the span they cover" />
    </ChartCard>
  )
}

function isInsideWindow(hour: number, window: EatingWindow): boolean {
  const minute = hour * 60
  if (window.endMinute > window.startMinute) {
    return minute >= window.startMinute && minute < window.endMinute
  }
  // Crosses midnight: inside means late evening or the small hours.
  return minute >= window.startMinute || minute < window.endMinute
}

const SOURCE_LABELS: Record<string, string> = {
  search: 'Searched',
  barcode: 'Scanned',
  describe: 'Described',
  quick: 'Quick add',
  copy: 'Repeated',
  template: 'Saved meal',
  recipe: 'Recipe',
  photo: 'Photo',
}

/**
 * How the food got logged.
 *
 * Not vanity: it says which shortcut is carrying the habit, and a log dominated by quick-adds is
 * one whose micronutrient numbers can't be trusted — a quick add has macros and nothing else.
 */
export function SourceMixChart({
  sourceCounts,
}: {
  sourceCounts: { source: string; count: number }[]
}) {
  const tokens = useChartTokens()
  const total = sourceCounts.reduce((sum, row) => sum + row.count, 0)

  const option: EChartsOption = {
    animation: false,
    grid: { left: 84, right: 30, top: 8, bottom: 24 },
    xAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: tokens.gridline } },
      axisLabel: { color: tokens.inkMuted, fontSize: 10 },
    },
    yAxis: {
      type: 'category',
      data: sourceCounts.map((row) => SOURCE_LABELS[row.source] ?? row.source).reverse(),
      axisLine: { lineStyle: { color: tokens.axis } },
      axisLabel: { color: tokens.inkMuted, fontSize: 10 },
    },
    tooltip: { trigger: 'axis' },
    series: [
      {
        type: 'bar',
        barMaxWidth: 14,
        itemStyle: { color: tokens.accent },
        data: sourceCounts.map((row) => row.count).reverse(),
      },
    ],
  }

  return (
    <ChartCard
      title="How you log"
      subtitle={total === 0 ? undefined : `${total} items over the window`}
      isEmpty={total === 0}
      emptyMessage="Log a few things to see this."
      table={{
        columns: ['Method', 'Items'],
        rows: sourceCounts.map((row) => [SOURCE_LABELS[row.source] ?? row.source, row.count]),
      }}
    >
      <Chart option={option} ariaLabel="Items logged by method" />
    </ChartCard>
  )
}
