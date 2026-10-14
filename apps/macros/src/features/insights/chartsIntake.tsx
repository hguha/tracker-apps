import { dayNoon, plural } from '@tracker-engine/core'
import type { EChartsOption } from 'echarts'
import { Chart, ChartCard } from '@tracker-engine/ui/charts'
import { categoryAxis, shortDay, targetMark, useChartTokens, valueAxis } from './chartTokens'
import { RankedBars } from './RankedBars'
import { meanKcal, type InsightsDay } from './useInsightsData'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Protein against the floor it was set as. The macro a deficit squeezes first, so it gets a
 *  chart of its own rather than a stripe in a stacked bar. */
export function ProteinChart({ days }: { days: InsightsDay[] }) {
  const tokens = useChartTokens()
  const option: EChartsOption = {
    animation: false,
    grid: { left: 40, right: 12, top: 12, bottom: 24 },
    xAxis: categoryAxis(tokens, days.map((day) => shortDay(day.day))),
    yAxis: valueAxis(tokens, { axisLabel: { formatter: '{value}g' } }),
    tooltip: { trigger: 'axis' },
    series: [
      {
        name: 'Protein',
        type: 'bar',
        barMaxWidth: 14,
        data: days.map((day) => ({
          value: Math.round(day.protein),
          itemStyle: {
            color: tokens.protein,
            opacity: day.targetProtein !== null && day.protein < day.targetProtein ? 0.45 : 1,
          },
        })),
      },
      {
        name: 'Floor',
        type: 'line',
        step: 'middle',
        ...targetMark(days.length),
        lineStyle: { color: tokens.on, type: 'dashed', width: 1.5 },
        data: days.map((day) => (day.targetProtein === null ? null : Math.round(day.targetProtein))),
      },
    ],
  }

  const met = days.filter(
    (day) => day.targetProtein !== null && day.protein >= day.targetProtein,
  ).length

  return (
    <ChartCard
      title="Protein"
      subtitle={days.length === 0 ? undefined : `Met on ${met} of ${days.length} logged days`}
      isEmpty={days.length === 0}
      emptyMessage="Log a few days to see this."
      table={{
        columns: ['Day', 'Protein (g)', 'Floor (g)'],
        rows: days.map((day) => [day.day, Math.round(day.protein), Math.round(day.targetProtein ?? 0)]),
      }}
    >
      <Chart option={option} ariaLabel="Protein per day against the target floor" />
    </ChartCard>
  )
}

/**
 * How tightly the target is being hit, as a distribution of daily misses.
 *
 * The average alone hides the shape: 1,800 and 2,600 on alternating days averages to target and
 * is a completely different week from hitting 2,200 twice.
 */
export function AdherenceChart({ days }: { days: InsightsDay[] }) {
  const tokens = useChartTokens()
  const scored = days.filter((day) => day.targetKcal !== null)

  const buckets = [
    { label: '< −500', min: -Infinity, max: -500 },
    { label: '−500…−250', min: -500, max: -250 },
    { label: '−250…−100', min: -250, max: -100 },
    { label: 'within 100', min: -100, max: 100 },
    { label: '+100…+250', min: 100, max: 250 },
    { label: '+250…+500', min: 250, max: 500 },
    { label: '> +500', min: 500, max: Infinity },
  ]
  const counts = buckets.map(
    (bucket) =>
      scored.filter((day) => {
        const delta = day.kcal - (day.targetKcal ?? 0)
        return delta >= bucket.min && delta < bucket.max
      }).length,
  )

  const option: EChartsOption = {
    animation: false,
    grid: { left: 30, right: 12, top: 12, bottom: 40 },
    xAxis: categoryAxis(
      tokens,
      buckets.map((bucket) => bucket.label),
      { fontSize: 9, rotate: 35 },
    ),
    yAxis: valueAxis(tokens, { minInterval: 1 }),
    tooltip: { trigger: 'axis' },
    series: [
      {
        type: 'bar',
        barMaxWidth: 26,
        data: counts.map((value, index) => ({
          value,
          itemStyle: { color: buckets[index]!.label === 'within 100' ? tokens.on : tokens.accent },
        })),
      },
    ],
  }

  return (
    <ChartCard
      title="How close to target"
      subtitle={`${plural(scored.length, 'day')} with a target in force`}
      isEmpty={scored.length === 0}
      emptyMessage="No days with a target yet."
      table={{
        columns: ['Miss', 'Days'],
        rows: buckets.map((bucket, index) => [bucket.label, counts[index] ?? 0]),
      }}
    >
      <Chart option={option} ariaLabel="Distribution of daily calorie misses" />
    </ChartCard>
  )
}

/** Average calories by weekday — where the weekend lives. */
export function WeekdayChart({ days }: { days: InsightsDay[] }) {
  const tokens = useChartTokens()

  const totals = WEEKDAYS.map(() => ({ sum: 0, count: 0 }))
  for (const day of days) {
    // Monday-first, to match the week the check-in measures.
    const index = (new Date(dayNoon(day.day)).getDay() + 6) % 7
    totals[index]!.sum += day.kcal
    totals[index]!.count += 1
  }
  const averages = totals.map((bucket) =>
    bucket.count === 0 ? null : Math.round(bucket.sum / bucket.count),
  )
  const overall = meanKcal(days)

  const option: EChartsOption = {
    animation: false,
    grid: { left: 44, right: 12, top: 12, bottom: 24 },
    xAxis: categoryAxis(tokens, WEEKDAYS),
    yAxis: valueAxis(tokens),
    tooltip: { trigger: 'axis' },
    series: [
      {
        type: 'bar',
        barMaxWidth: 24,
        data: averages,
        itemStyle: { color: tokens.accent },
        markLine: {
          silent: true,
          symbol: 'none',
          label: {
            formatter: 'average',
            position: 'insideEndTop',
            color: tokens.inkMuted,
            fontSize: 10,
          },
          lineStyle: { color: tokens.inkMuted, type: 'dashed' },
          data: [{ yAxis: overall }],
        },
      },
    ],
  }

  return (
    <ChartCard
      title="By day of the week"
      subtitle={days.length === 0 ? undefined : `Average ${overall} kcal`}
      isEmpty={days.length === 0}
      emptyMessage="Log a few days to see this."
      table={{
        columns: ['Weekday', 'Average kcal'],
        rows: WEEKDAYS.map((label, index) => [label, averages[index] ?? '—']),
      }}
    >
      <Chart option={option} ariaLabel="Average calories by weekday" />
    </ChartCard>
  )
}

/**
 * Where the calories actually came from, by food.
 *
 * The most actionable chart in the app for most people: a diet is usually four or five foods
 * carrying half the week, and nobody knows which until they see it.
 */
export function TopFoodsChart({
  topFoods,
}: {
  topFoods: { name: string; kcal: number; entries: number }[]
}) {
  const total = topFoods.reduce((sum, food) => sum + food.kcal, 0)

  return (
    <ChartCard
      title="Your biggest sources"
      subtitle={total === 0 ? undefined : `Top ${topFoods.length} foods by calories`}
      isEmpty={topFoods.length === 0}
      emptyMessage="Log a few days to see this."
      table={{
        columns: ['Food', 'kcal', 'Times'],
        rows: topFoods.map((food) => [food.name, food.kcal, food.entries]),
      }}
    >
      <RankedBars
        labels={topFoods.map((food) => truncate(food.name))}
        values={topFoods.map((food) => food.kcal)}
        gridLeft={120}
        labelFontSize={9.5}
        ariaLabel="Foods contributing the most calories"
      />
    </ChartCard>
  )
}

const truncate = (text: string): string => (text.length > 22 ? `${text.slice(0, 21)}…` : text)
