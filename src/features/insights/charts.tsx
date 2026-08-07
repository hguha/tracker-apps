/**
 * The chart catalog (§9). Each export is one chart from the spec, keyed by its
 * catalog id in the comment.
 *
 * Every chart here obeys the same rules:
 *   - Form chosen by the data's job, then color by *its* job (§10.1).
 *   - No dual axes, ever. Two measures of different scale become two charts or
 *     both indexed to a common base.
 *   - A legend whenever there are 2+ series; selective direct labels, never a
 *     number on every point.
 *   - Region colors come from the fixed palette and never shift with a filter.
 */

import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import { format } from 'date-fns'
import { TrendingUp } from 'lucide-react'
import { Card } from '@/components/Card'
import { Chart } from './Chart'
import { ChartCard } from './ChartCard'
import { baseOption, categoryAxis, chrome, valueAxis } from './chartTheme'
import { REP_BUCKETS, type InsightsData } from './useInsightsData'
import { useAppearanceKey } from '@/lib/useColorScheme'
import { regionVar, resolveRegionColor, resolveToken } from '@/lib/palette'
import { MOVEMENT_PATTERNS, REGION_LABELS, REGIONS } from '@/domain/types'
import { convertWeight, displayWeight, formatDuration, weightFromKg } from '@/lib/units'
import { weekKey } from '@/lib/dates'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function weekLabels(weeks: string[]): string[] {
  return weeks.map((week) => format(new Date(week), 'MMM d'))
}

// ─────────────────────────────────────────────────────────── A-4 volume trend

/** Total volume per week, with a moving average as the emphasis line. */
export function WeeklyVolumeChart({ data }: { data: InsightsData }) {
  const appearance = useAppearanceKey()
  const unit = data.profile.unitWeight

  // One memo over the stable inputs: the derivations and the option are built
  // together, so `option`'s identity is stable across re-renders that don't
  // change the data (e.g. switching Insights sub-tabs) and setOption doesn't
  // needlessly re-run. `appearance` is a dep because chrome() reads the theme.
  const { option, labels, points, movingAverage } = useMemo(() => {
    const labels = weekLabels(data.weeks)
    const points = data.weeks.map((week) =>
      Math.round(convertWeight(data.volumeByWeek.get(week) ?? 0, unit)),
    )
    const movingAverage = points.map((_, index) => {
      const window = points.slice(Math.max(0, index - 3), index + 1)
      return Math.round(window.reduce((a, b) => a + b, 0) / window.length)
    })
    const c = chrome()
    const option: EChartsOption = {
      ...baseOption(c),
      legend: {
        show: true,
        bottom: 0,
        itemWidth: 12,
        itemHeight: 2,
        textStyle: { color: c.muted, fontSize: 11 },
      },
      grid: { left: 8, right: 12, top: 12, bottom: 28, containLabel: true },
      xAxis: categoryAxis(c, labels),
      yAxis: valueAxis(c),
      series: [
        {
          name: `Volume (${unit})`,
          type: 'line',
          data: points,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { width: 2, color: c.plot },
          itemStyle: { color: c.plot },
        },
        {
          // The trend is the point; the raw line is context, so it recedes.
          name: '4-week average',
          type: 'line',
          data: movingAverage,
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, color: c.muted },
        },
      ],
    }
    return { option, labels, points, movingAverage }
  }, [data, unit, appearance])

  return (
    <ChartCard
      title="Volume per week"
      subtitle={`Total load lifted, in ${unit}`}
      isEmpty={data.weeks.length < 2}
      emptyMessage="Log workouts in two different weeks to see a trend."
      table={{
        columns: ['Week', `Volume (${unit})`, '4-wk avg'],
        rows: labels.map((label, index) => [
          label,
          points[index]!.toLocaleString(),
          movingAverage[index]!.toLocaleString(),
        ]),
      }}
    >
      <Chart option={option} ariaLabel="Line chart of total training volume per week" />
    </ChartCard>
  )
}

// ────────────────────────────────────────────────────── C-20 share of work

/**
 * Where training goes, as a 100% stacked bar rather than a pie.
 *
 * With seven regions often close in size, angle comparison is the task human
 * vision is worst at; bar length is read accurately. Direct labels carry the
 * identity because three of these colors are below 3:1 on the light surface.
 */
export function RegionShareChart({ data }: { data: InsightsData }) {
  const unit = data.profile.unitWeight
  const entries = REGIONS.map((region) => ({
    region,
    value: data.volumeByRegion.get(region) ?? 0,
  })).filter((entry) => entry.value > 0)

  const total = entries.reduce((sum, entry) => sum + entry.value, 0)

  return (
    <ChartCard
      title="Where the work goes"
      subtitle="Share of volume by body part"
      isEmpty={total === 0}
      emptyMessage="Log some weighted sets to see your split."
      table={{
        columns: ['Body part', 'Share', `Volume (${unit})`],
        rows: entries.map((entry) => [
          REGION_LABELS[entry.region],
          `${((entry.value / total) * 100).toFixed(1)}%`,
          Math.round(convertWeight(entry.value, unit)).toLocaleString(),
        ]),
      }}
    >
      <div className="px-2 pb-1 pt-2">
        {/* 2px surface gaps between segments rather than borders around them. */}
        <div className="flex h-7 gap-[2px] overflow-hidden rounded-lg">
          {entries.map((entry) => (
            <div
              key={entry.region}
              style={{
                width: `${(entry.value / total) * 100}%`,
                background: regionVar(entry.region),
              }}
              title={REGION_LABELS[entry.region]}
            />
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
          {entries.map((entry) => (
            <span key={entry.region} className="flex items-center gap-1.5 text-[12.5px]">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: regionVar(entry.region) }}
                aria-hidden
              />
              <span className="flex-1 truncate text-ink-secondary">
                {REGION_LABELS[entry.region]}
              </span>
              <span className="tabular font-semibold">
                {Math.round((entry.value / total) * 100)}%
              </span>
            </span>
          ))}
        </div>
      </div>
    </ChartCard>
  )
}

// ──────────────────────────────────────────── C-21 region volume over time

/** How emphasis has shifted. Categorical — the regions are the subject. */
export function RegionVolumeOverTimeChart({ data }: { data: InsightsData }) {
  const appearance = useAppearanceKey()
  const unit = data.profile.unitWeight

  const { option, labels, seriesData, activeRegions } = useMemo(() => {
    const labels = weekLabels(data.weeks)
    const activeRegions = REGIONS.filter(
      (region) => (data.volumeByRegion.get(region) ?? 0) > 0,
    )
    const seriesData = activeRegions.map((region) => ({
      region,
      values: data.weeks.map((week) =>
        Math.round(
          convertWeight(data.regionVolumeByWeek.get(week)?.get(region) ?? 0, unit),
        ),
      ),
    }))
    const c = chrome()
    const option: EChartsOption = {
      ...baseOption(c),
      legend: {
        show: true,
        bottom: 0,
        itemWidth: 10,
        itemHeight: 10,
        itemGap: 10,
        textStyle: { color: c.muted, fontSize: 11 },
      },
      grid: { left: 8, right: 12, top: 12, bottom: 30, containLabel: true },
      xAxis: categoryAxis(c, labels),
      yAxis: valueAxis(c),
      series: seriesData.map((series) => ({
        name: REGION_LABELS[series.region],
        type: 'bar' as const,
        stack: 'volume',
        data: series.values,
        // Color follows the region, fixed — never reassigned by rank.
        itemStyle: { color: resolveRegionColor(series.region) },
        barMaxWidth: 28,
      })),
    }
    return { option, labels, seriesData, activeRegions }
  }, [data, unit, appearance])

  return (
    <ChartCard
      title="Emphasis over time"
      subtitle="Weekly volume by body part"
      isEmpty={activeRegions.length === 0 || data.weeks.length < 2}
      emptyMessage="Two weeks of workouts will show how your emphasis shifts."
      table={{
        columns: ['Week', ...activeRegions.map((r) => REGION_LABELS[r])],
        rows: labels.map((label, index) => [
          label,
          ...seriesData.map((series) => series.values[index]!.toLocaleString()),
        ]),
      }}
    >
      <Chart
        option={option}
        height={240}
        ariaLabel="Stacked bar chart of weekly training volume by body part"
      />
    </ChartCard>
  )
}

// ───────────────────────────────────────────────────── A-5 sets by body part

/** Sets per body part in range, with a direct label per bar. */
export function SetsByRegionChart({ data }: { data: InsightsData }) {
  const entries = REGIONS.map((region) => ({
    region,
    count: data.setsByRegion.get(region) ?? 0,
  })).filter((entry) => entry.count > 0)

  const max = Math.max(1, ...entries.map((entry) => entry.count))

  return (
    <ChartCard
      title="Sets by body part"
      subtitle="Working sets in this range"
      isEmpty={entries.length === 0}
      emptyMessage="Log some sets to see your balance."
      table={{
        columns: ['Body part', 'Sets'],
        rows: entries.map((entry) => [REGION_LABELS[entry.region], entry.count]),
      }}
    >
      <div className="space-y-2 px-2 py-2">
        {entries.map((entry) => (
          <div key={entry.region} className="flex items-center gap-2.5">
            <span className="w-20 shrink-0 text-[13px] text-ink-secondary">
              {REGION_LABELS[entry.region]}
            </span>
            <div className="h-5 flex-1 overflow-hidden rounded-md bg-sunken">
              <div
                className="h-full rounded-md"
                style={{
                  width: `${(entry.count / max) * 100}%`,
                  background: regionVar(entry.region),
                }}
              />
            </div>
            <span className="tabular w-6 shrink-0 text-right text-[13px] font-semibold">
              {entry.count}
            </span>
          </div>
        ))}
      </div>
    </ChartCard>
  )
}

// ───────────────────────────────────────────────── B-8 e1RM progression

/**
 * Estimated 1RM over time for one lift, as **emphasis**: one lift in the accent
 * hue, nothing else competing.
 *
 * This chart is inherently about a *single* lift — there's no "all exercises"
 * version of one progression line. So when the shared Exercise filter names
 * exactly one lift, that's the subject; otherwise it shows a prompt card asking
 * for one, rather than silently guessing (which read as confusing).
 */
export function StrengthProgressionChart({
  data,
  activeExerciseId,
}: {
  data: InsightsData
  /** The single lift to chart, or null when the filter isn't narrowed to one. */
  activeExerciseId: string | null
}) {
  const appearance = useAppearanceKey()
  const unit = data.profile.unitWeight

  const active = activeExerciseId
    ? data.exerciseSeries.find((series) => series.exerciseId === activeExerciseId)
    : undefined

  const option = useMemo<EChartsOption>(() => {
    const c = chrome()
    const points = (active?.points ?? []).filter((p) => p.e1rmKg !== null)
    return {
      ...baseOption(c),
      xAxis: categoryAxis(
        c,
        points.map((p) => format(p.at, 'MMM d')),
      ),
      yAxis: valueAxis(c),
      series: [
        {
          name: `e1RM (${unit})`,
          type: 'line',
          data: points.map((p) => Math.round(convertWeight(p.e1rmKg!, unit))),
          symbol: 'circle',
          symbolSize: 7,
          lineStyle: { width: 2, color: c.plot },
          itemStyle: { color: c.plot, borderColor: c.surface, borderWidth: 2 },
        },
      ],
    }
    // `active` is derived from data+activeExerciseId; both are stable roots.
  }, [active, unit, appearance])

  if (!active) {
    return (
      <PickExerciseCard
        title="Strength progression"
        subtitle="Estimated 1RM over time for one lift"
      />
    )
  }

  return (
    <ChartCard
      title="Strength progression"
      subtitle={`${active.name} — estimated 1RM in ${unit}`}
      isEmpty={active.points.filter((p) => p.e1rmKg !== null).length < 2}
      emptyMessage="Log this lift on two different days to see progression."
      table={{
        columns: ['Date', `e1RM (${unit})`],
        rows: [...active.points]
          .filter((p) => p.e1rmKg !== null)
          .reverse()
          .map((p) => [
            format(p.at, 'MMM d, yyyy'),
            Math.round(convertWeight(p.e1rmKg!, unit)).toLocaleString(),
          ]),
      }}
    >
      <Chart option={option} ariaLabel="Line chart of estimated one-rep max over time" />
    </ChartCard>
  )
}

/**
 * Shown in place of a per-exercise chart when the Exercise filter hasn't been
 * narrowed to a single lift. Explains what to do rather than guessing at one.
 */
function PickExerciseCard({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="px-4 pt-3.5">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        <p className="text-[12.5px] text-ink-muted">{subtitle}</p>
      </div>
      <div className="flex items-center gap-3 px-4 py-6">
        <TrendingUp size={22} className="shrink-0 text-ink-muted" />
        <p className="text-[13.5px] text-ink-secondary">
          Pick one exercise in the{' '}
          <span className="font-semibold text-ink">Exercise</span> filter above to see
          this chart.
        </p>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────── B-9 top-set weight

/** The heaviest working set per session for one lift. */
export function TopSetChart({
  data,
  activeExerciseId,
}: {
  data: InsightsData
  activeExerciseId: string | null
}) {
  const appearance = useAppearanceKey()
  const unit = data.profile.unitWeight

  const active = activeExerciseId
    ? data.exerciseSeries.find((s) => s.exerciseId === activeExerciseId)
    : undefined

  const { option, points } = useMemo(() => {
    const points = (active?.points ?? []).filter((p) => p.topSetKg !== null)
    const c = chrome()
    const option: EChartsOption = {
      ...baseOption(c),
      xAxis: categoryAxis(
        c,
        points.map((p) => format(p.at, 'MMM d')),
      ),
      yAxis: valueAxis(c),
      series: [
        {
          name: `Top set (${unit})`,
          type: 'line',
          step: 'end',
          data: points.map((p) => Math.round(weightFromKg(p.topSetKg!, unit))),
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { width: 2, color: c.plot },
          itemStyle: { color: c.plot },
        },
      ],
    }
    return { option, points }
  }, [active, unit, appearance])

  if (!active) {
    return (
      <PickExerciseCard
        title="Top set"
        subtitle="Heaviest set per session for one lift"
      />
    )
  }

  return (
    <ChartCard
      title="Top set"
      subtitle={`${active.name} — heaviest set per session`}
      isEmpty={points.length < 2}
      emptyMessage="Log this lift twice to see how the top set moves."
      table={{
        columns: ['Date', `Top set (${unit})`],
        rows: [...points]
          .reverse()
          .map((p) => [
            format(p.at, 'MMM d, yyyy'),
            Math.round(weightFromKg(p.topSetKg!, unit)).toLocaleString(),
          ]),
      }}
    >
      <Chart option={option} ariaLabel="Step chart of heaviest set per session" />
    </ChartCard>
  )
}

// ────────────────────────────────────────── C-27 rep-range distribution

/**
 * How the training is actually distributed across rep ranges.
 *
 * The buckets are **ordered**, so this uses the sequential ramp rather than
 * categorical hues — a value ramp is correct here precisely because the
 * categories have a natural order.
 */
export function RepRangeChart({ data }: { data: InsightsData }) {
  const appearance = useAppearanceKey()

  const { option, counts, total } = useMemo(() => {
    const counts = REP_BUCKETS.map((bucket) => data.repBuckets.get(bucket) ?? 0)
    const total = counts.reduce((a, b) => a + b, 0)
    const c = chrome()
    // Ordinal ramp: the lightest step still clears 2:1 against the surface.
    const ramp = [
      resolveToken('--seq-300', '#6da7ec'),
      resolveToken('--seq-400', '#3987e5'),
      resolveToken('--seq-500', '#256abf'),
      resolveToken('--seq-600', '#184f95'),
      resolveToken('--seq-700', '#0d366b'),
    ]
    const option: EChartsOption = {
      ...baseOption(c),
      tooltip: { ...baseOption(c).tooltip, trigger: 'item' },
      xAxis: categoryAxis(c, [...REP_BUCKETS]),
      yAxis: valueAxis(c, { name: 'sets' }),
      series: [
        {
          type: 'bar',
          data: counts.map((value, index) => ({
            value,
            itemStyle: { color: ramp[index] },
          })),
          barMaxWidth: 44,
          itemStyle: { borderRadius: [4, 4, 0, 0] },
        },
      ],
    }
    return { option, counts, total }
  }, [data, appearance])

  return (
    <ChartCard
      title="Rep ranges"
      subtitle="How your sets are distributed"
      isEmpty={total === 0}
      emptyMessage="Log some sets with reps to see your distribution."
      table={{
        columns: ['Rep range', 'Sets', 'Share'],
        rows: REP_BUCKETS.map((bucket, index) => [
          bucket,
          counts[index]!,
          `${total === 0 ? 0 : Math.round((counts[index]! / total) * 100)}%`,
        ]),
      }}
    >
      <Chart option={option} ariaLabel="Bar chart of sets by rep range" />
    </ChartCard>
  )
}

// ─────────────────────────────────────────────── D-34 workouts per week

export function WorkoutsPerWeekChart({ data }: { data: InsightsData }) {
  const appearance = useAppearanceKey()

  const { option, labels, counts } = useMemo(() => {
    const labels = weekLabels(data.weeks)
    const counts = data.weeks.map((week) => data.workoutsByWeek.get(week) ?? 0)
    const c = chrome()
    const option: EChartsOption = {
      ...baseOption(c),
      xAxis: categoryAxis(c, labels),
      yAxis: valueAxis(c, { name: 'workouts' }),
      series: [
        {
          type: 'bar',
          data: counts,
          barMaxWidth: 28,
          itemStyle: { color: c.plot, borderRadius: [4, 4, 0, 0] },
        },
      ],
    }
    return { option, labels, counts }
  }, [data, appearance])

  return (
    <ChartCard
      title="Workouts per week"
      subtitle="Are you holding the habit?"
      isEmpty={data.weeks.length < 2}
      emptyMessage="Two weeks of history will show your consistency."
      table={{
        columns: ['Week', 'Workouts'],
        rows: labels.map((label, index) => [label, counts[index]!]),
      }}
    >
      <Chart option={option} ariaLabel="Bar chart of workouts per week" />
    </ChartCard>
  )
}

// ──────────────────────────────────────────── D-35 day-of-week frequency

export function DayOfWeekChart({ data }: { data: InsightsData }) {
  const appearance = useAppearanceKey()

  const { option, labels, counts } = useMemo(() => {
    // Rotate so the week starts where the user says it does.
    const order = Array.from({ length: 7 }, (_, i) => (i + data.profile.weekStartsOn) % 7)
    const labels = order.map((day) => DAY_LABELS[day]!)
    const counts = order.map((day) => data.dayOfWeekCounts[day]!)
    const c = chrome()
    const option: EChartsOption = {
      ...baseOption(c),
      xAxis: categoryAxis(c, labels),
      yAxis: valueAxis(c, { name: 'workouts' }),
      series: [
        {
          type: 'bar',
          data: counts,
          barMaxWidth: 32,
          itemStyle: { color: c.plot, borderRadius: [4, 4, 0, 0] },
        },
      ],
    }
    return { option, labels, counts }
  }, [data, appearance])

  return (
    <ChartCard
      title="Which days you train"
      subtitle="Sessions by day of week"
      isEmpty={data.workoutCount === 0}
      emptyMessage="Log a few workouts to see your weekly pattern."
      table={{
        columns: ['Day', 'Workouts'],
        rows: labels.map((label, index) => [label, counts[index]!]),
      }}
    >
      <Chart option={option} ariaLabel="Bar chart of workouts by day of week" />
    </ChartCard>
  )
}

// ─────────────────────────────────────────────── C-31 volume vs duration

/** Session density — is a longer workout actually more work? */
export function VolumeVsDurationChart({ data }: { data: InsightsData }) {
  const appearance = useAppearanceKey()
  const unit = data.profile.unitWeight

  const { option, points } = useMemo(() => {
    const points = data.sessions
      .filter((s) => s.durationSeconds !== null && s.volumeKg > 0)
      .map((s) => [
        Math.round(s.durationSeconds! / 60),
        Math.round(convertWeight(s.volumeKg, unit)),
        s.at,
      ])
    const c = chrome()
    const option: EChartsOption = {
      ...baseOption(c),
      tooltip: {
        ...baseOption(c).tooltip,
        trigger: 'item',
        formatter: (params: unknown) => {
          const point = params as { value: [number, number, number] }
          return `${format(point.value[2], 'MMM d')}<br/>${point.value[0]} min · ${point.value[1].toLocaleString()} ${unit}`
        },
      },
      xAxis: valueAxis(c, { name: 'minutes' }),
      yAxis: valueAxis(c, { name: unit }),
      series: [
        {
          type: 'scatter',
          data: points,
          symbolSize: 9,
          itemStyle: { color: c.plot, borderColor: c.surface, borderWidth: 2 },
        },
      ],
    }
    return { option, points }
  }, [data, unit, appearance])

  return (
    <ChartCard
      title="Volume vs duration"
      subtitle="Denser sessions, or just longer ones?"
      isEmpty={points.length < 3}
      emptyMessage="Three finished workouts will show whether longer means more work."
      table={{
        columns: ['Date', 'Minutes', `Volume (${unit})`],
        rows: [...points]
          .reverse()
          .map((p) => [format(p[2]!, 'MMM d'), p[0]!, p[1]!.toLocaleString()]),
      }}
    >
      <Chart
        option={option}
        ariaLabel="Scatter plot of session volume against duration"
      />
    </ChartCard>
  )
}

// ───────────────────────────────────────────────── E-42 bodyweight trend

/**
 * Bodyweight as **emphasis**: raw daily readings recede to gray, the 7-day
 * moving average carries the accent — because a single day's weight is noise and
 * the trend is the signal.
 */
export function BodyweightChart({ data }: { data: InsightsData }) {
  const appearance = useAppearanceKey()
  const unit = data.profile.unitWeight
  const entries = data.bodyMetrics.get('bodyweight') ?? []

  const { option, labels, raw, average } = useMemo(() => {
    const raw = entries.map((e) => weightFromKg(e.value, unit, 0.1))
    const average = raw.map((_, index) => {
      const window = raw.slice(Math.max(0, index - 6), index + 1)
      return Number((window.reduce((a, b) => a + b, 0) / window.length).toFixed(1))
    })
    const labels = entries.map((e) => format(e.at, 'MMM d'))
    const c = chrome()
    const option: EChartsOption = {
      ...baseOption(c),
      legend: {
        show: true,
        bottom: 0,
        itemWidth: 12,
        itemHeight: 2,
        textStyle: { color: c.muted, fontSize: 11 },
      },
      grid: { left: 8, right: 12, top: 12, bottom: 28, containLabel: true },
      xAxis: categoryAxis(c, labels),
      yAxis: { ...valueAxis(c), scale: true },
      series: [
        {
          name: 'Daily',
          type: 'line',
          data: raw,
          symbol: 'circle',
          symbolSize: 4,
          lineStyle: { width: 0 },
          itemStyle: { color: c.muted },
        },
        {
          name: '7-day average',
          type: 'line',
          data: average,
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2.5, color: c.plot },
        },
      ],
    }
    return { option, labels, raw, average }
  }, [entries, unit, appearance])

  return (
    <ChartCard
      title="Bodyweight"
      subtitle={`Daily readings and the 7-day trend, in ${unit}`}
      isEmpty={entries.length < 2}
      emptyMessage="Log your weight twice to see a trend."
      table={{
        columns: ['Date', unit, '7-day avg'],
        rows: labels
          .map((label, index) => [label, raw[index]!, average[index]!])
          .reverse(),
      }}
    >
      <Chart option={option} ariaLabel="Line chart of bodyweight over time" />
    </ChartCard>
  )
}

// ─────────────────────────────────────────────────────── D-41 cardio volume

/**
 * Cardio time and distance as **two separate charts**, never two y-axes — the
 * alignment of two scales on one plot invents a correlation that isn't there.
 */
export function CardioChart({ data }: { data: InsightsData }) {
  const unit = data.profile.unitDistance
  const hasCardio = data.cardioSeconds > 0 || data.cardioMeters > 0

  const totalDistance =
    unit === 'km' ? data.cardioMeters / 1000 : data.cardioMeters / 1609.344

  return (
    <ChartCard
      title="Cardio"
      subtitle="Kept separate from lifting volume"
      isEmpty={!hasCardio}
      emptyMessage="Log a run, ride, or row to see cardio totals."
      table={{
        columns: ['Measure', 'Total'],
        rows: [
          ['Time', formatDuration(data.cardioSeconds)],
          ['Distance', `${totalDistance.toFixed(2)} ${unit}`],
        ],
      }}
    >
      <div className="grid grid-cols-2 gap-2 px-2 py-3">
        <div className="rounded-xl border border-line bg-sunken px-3.5 py-2.5">
          <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">
            Total time
          </p>
          <p className="mt-0.5 text-[21px] font-bold leading-tight">
            {formatDuration(data.cardioSeconds)}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-sunken px-3.5 py-2.5">
          <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">
            Total distance
          </p>
          <p className="mt-0.5 text-[21px] font-bold leading-tight">
            {totalDistance.toFixed(1)}
            <span className="ml-1 text-[13px] font-semibold text-ink-muted">{unit}</span>
          </p>
        </div>
      </div>
    </ChartCard>
  )
}

// ───────────────────────────────────────────────────── D-37 time of day
/** When sessions start, over 24 hours. */
export function TimeOfDayChart({ data }: { data: InsightsData }) {
  const appearance = useAppearanceKey()

  const option = useMemo<EChartsOption>(() => {
    const labels = data.hourCounts.map((_, h) => (h % 3 === 0 ? formatHour(h) : ''))
    const c = chrome()
    return {
      ...baseOption(c),
      tooltip: { ...baseOption(c).tooltip, trigger: 'item' },
      xAxis: categoryAxis(c, labels),
      yAxis: valueAxis(c, { name: 'workouts' }),
      series: [
        {
          type: 'bar',
          data: data.hourCounts,
          barMaxWidth: 14,
          itemStyle: { color: c.plot, borderRadius: [3, 3, 0, 0] },
        },
      ],
    }
  }, [data.hourCounts, appearance])

  return (
    <ChartCard
      title="Time of day"
      subtitle="When your sessions start"
      isEmpty={data.workoutCount === 0}
      emptyMessage="Log a few workouts to see when you train."
      table={{
        columns: ['Hour', 'Workouts'],
        rows: data.hourCounts
          .map((count, hour) => [formatHour(hour), count] as [string, number])
          .filter(([, count]) => count > 0),
      }}
    >
      <Chart option={option} ariaLabel="Histogram of session start times over 24 hours" />
    </ChartCard>
  )
}

// ──────────────────────────────────────────────────── D-40 duration trend
/** Session length over time, with a moving average. */
export function DurationTrendChart({ data }: { data: InsightsData }) {
  const appearance = useAppearanceKey()

  const { option, labels, minutes, average, withDuration } = useMemo(() => {
    const withDuration = data.sessions.filter((s) => s.durationSeconds !== null)
    const labels = withDuration.map((s) => format(s.at, 'MMM d'))
    const minutes = withDuration.map((s) => Math.round(s.durationSeconds! / 60))
    const average = minutes.map((_, index) => {
      const window = minutes.slice(Math.max(0, index - 3), index + 1)
      return Math.round(window.reduce((a, b) => a + b, 0) / window.length)
    })
    const c = chrome()
    const option: EChartsOption = {
      ...baseOption(c),
      legend: {
        show: true,
        bottom: 0,
        itemWidth: 12,
        itemHeight: 2,
        textStyle: { color: c.muted, fontSize: 11 },
      },
      grid: { left: 8, right: 12, top: 12, bottom: 28, containLabel: true },
      xAxis: categoryAxis(c, labels),
      yAxis: valueAxis(c, { name: 'min' }),
      series: [
        {
          name: 'Duration',
          type: 'line',
          data: minutes,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { width: 2, color: c.plot },
          itemStyle: { color: c.plot },
        },
        {
          name: '4-session average',
          type: 'line',
          data: average,
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, color: c.muted },
        },
      ],
    }
    return { option, labels, minutes, average, withDuration }
  }, [data, appearance])

  return (
    <ChartCard
      title="Workout duration"
      subtitle="Are sessions getting longer?"
      isEmpty={withDuration.length < 2}
      emptyMessage="Finish two workouts to see how long they run."
      table={{
        columns: ['Date', 'Minutes', '4-session avg'],
        rows: labels
          .map(
            (label, i) => [label, minutes[i]!, average[i]!] as [string, number, number],
          )
          .reverse(),
      }}
    >
      <Chart option={option} ariaLabel="Line chart of workout duration over time" />
    </ChartCard>
  )
}

// ───────────────────────────────────────────────── C-30 sets per session
/** Distribution of working-set counts per session. */
export function SetsPerSessionChart({ data }: { data: InsightsData }) {
  const appearance = useAppearanceKey()
  // Bucket into ranges of 5 so the histogram stays readable.
  const buckets = ['1-5', '6-10', '11-15', '16-20', '21-25', '26+']

  const { option, tally, counts } = useMemo(() => {
    const counts = data.sessions.map((s) => s.setCount).filter((n) => n > 0)
    const tally = new Array<number>(buckets.length).fill(0)
    for (const count of counts) {
      const index = Math.min(buckets.length - 1, Math.floor((count - 1) / 5))
      tally[index]! += 1
    }
    const c = chrome()
    const option: EChartsOption = {
      ...baseOption(c),
      tooltip: { ...baseOption(c).tooltip, trigger: 'item' },
      xAxis: categoryAxis(c, buckets),
      yAxis: valueAxis(c, { name: 'sessions' }),
      series: [
        {
          type: 'bar',
          data: tally,
          barMaxWidth: 40,
          itemStyle: { color: c.plot, borderRadius: [4, 4, 0, 0] },
        },
      ],
    }
    return { option, tally, counts }
    // buckets is a module-stable literal; data and appearance are the real roots.
  }, [data, appearance])

  return (
    <ChartCard
      title="Sets per session"
      subtitle="How much work per workout"
      isEmpty={counts.length < 2}
      emptyMessage="Log a couple of sessions to see the spread."
      table={{
        columns: ['Sets', 'Sessions'],
        rows: buckets.map((bucket, i) => [bucket, tally[i]!]),
      }}
    >
      <Chart option={option} ariaLabel="Histogram of working sets per session" />
    </ChartCard>
  )
}

// ─────────────────────────────────────────────────── C-33 exercise variety
/** Distinct exercises trained per week. */
export function ExerciseVarietyChart({ data }: { data: InsightsData }) {
  const appearance = useAppearanceKey()

  const { option, labels, counts } = useMemo(() => {
    const labels = weekLabels(data.weeks)
    // Recompute distinct exercises per week from the exercise series points.
    const distinctByWeek = new Map<string, Set<string>>()
    for (const series of data.exerciseSeries) {
      for (const point of series.points) {
        const week = weekKey(point.at, data.profile.weekStartsOn)
        const set = distinctByWeek.get(week) ?? new Set<string>()
        set.add(series.exerciseId)
        distinctByWeek.set(week, set)
      }
    }
    const counts = data.weeks.map((week) => distinctByWeek.get(week)?.size ?? 0)
    const c = chrome()
    const option: EChartsOption = {
      ...baseOption(c),
      xAxis: categoryAxis(c, labels),
      yAxis: valueAxis(c, { name: 'lifts' }),
      series: [
        {
          type: 'line',
          data: counts,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { width: 2, color: c.plot },
          itemStyle: { color: c.plot },
        },
      ],
    }
    return { option, labels, counts }
  }, [data, appearance])

  return (
    <ChartCard
      title="Exercise variety"
      subtitle="Distinct lifts each week"
      isEmpty={data.weeks.length < 2}
      emptyMessage="Two weeks of history will show how varied your training is."
      table={{
        columns: ['Week', 'Distinct lifts'],
        rows: labels.map((label, i) => [label, counts[i]!]),
      }}
    >
      <Chart
        option={option}
        ariaLabel="Line chart of distinct exercises trained per week"
      />
    </ChartCard>
  )
}

// ──────────────────────────────────────────────────── B-17 per-exercise volume
/** Volume per session for the filtered lift. */
export function PerExerciseVolumeChart({
  data,
  activeExerciseId,
}: {
  data: InsightsData
  activeExerciseId: string | null
}) {
  const appearance = useAppearanceKey()
  const unit = data.profile.unitWeight
  const active = activeExerciseId
    ? data.exerciseSeries.find((s) => s.exerciseId === activeExerciseId)
    : undefined

  const { option, labels, values, points } = useMemo(() => {
    const points = (active?.points ?? []).filter((p) => p.volumeKg > 0)
    const labels = points.map((p) => format(p.at, 'MMM d'))
    const values = points.map((p) => Math.round(convertWeight(p.volumeKg, unit)))
    const c = chrome()
    const option: EChartsOption = {
      ...baseOption(c),
      xAxis: categoryAxis(c, labels),
      yAxis: valueAxis(c, { name: unit }),
      series: [
        {
          type: 'bar',
          data: values,
          barMaxWidth: 28,
          itemStyle: { color: c.plot, borderRadius: [4, 4, 0, 0] },
        },
      ],
    }
    return { option, labels, values, points }
  }, [active, unit, appearance])

  if (!active) {
    return (
      <PickExerciseCard
        title="Volume per session"
        subtitle="Training load per session for one lift"
      />
    )
  }

  return (
    <ChartCard
      title="Volume per session"
      subtitle={`${active.name} — load per session in ${unit}`}
      isEmpty={points.length < 2}
      emptyMessage="Log this lift on two days to see its volume trend."
      table={{
        columns: ['Date', `Volume (${unit})`],
        rows: labels.map((label, i) => [label, values[i]!.toLocaleString()]).reverse(),
      }}
    >
      <Chart option={option} ariaLabel="Bar chart of per-exercise volume per session" />
    </ChartCard>
  )
}

// ─────────────────────────────────────────────── C-25 pattern coverage
/** Working sets per movement pattern — surfaces a neglected pattern. */
export function PatternCoverageChart({ data }: { data: InsightsData }) {
  const appearance = useAppearanceKey()

  const { option, entries } = useMemo(() => {
    const entries = MOVEMENT_PATTERNS.map((pattern) => ({
      pattern,
      count: data.setsByPattern.get(pattern) ?? 0,
    })).filter((e) => e.count > 0)
    const labels = entries.map((e) => titleCasePattern(e.pattern))
    const c = chrome()
    const option: EChartsOption = {
      ...baseOption(c),
      tooltip: { ...baseOption(c).tooltip, trigger: 'item' },
      grid: { left: 8, right: 16, top: 8, bottom: 4, containLabel: true },
      xAxis: valueAxis(c, { name: 'sets' }),
      yAxis: { ...categoryAxis(c, labels), inverse: true },
      series: [
        {
          type: 'bar',
          data: entries.map((e) => e.count),
          barMaxWidth: 18,
          itemStyle: { color: c.plot, borderRadius: [0, 4, 4, 0] },
        },
      ],
    }
    return { option, entries }
  }, [data, appearance])

  return (
    <ChartCard
      title="Pattern coverage"
      subtitle="Working sets per movement pattern"
      isEmpty={entries.length === 0}
      emptyMessage="Log some sets to see which movement patterns you train."
      table={{
        columns: ['Pattern', 'Sets'],
        rows: entries.map((e) => [titleCasePattern(e.pattern), e.count]),
      }}
    >
      <Chart
        option={option}
        height={Math.max(160, entries.length * 30)}
        ariaLabel="Bar chart of working sets per movement pattern"
      />
    </ChartCard>
  )
}

// ─────────────────────────────────────────────────── C-26 equipment mix
/** Where training happens — working sets per equipment type. */
export function EquipmentMixChart({ data }: { data: InsightsData }) {
  const appearance = useAppearanceKey()

  const { option, entries } = useMemo(() => {
    const entries = [...data.setsByEquipment.entries()]
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
    const labels = entries.map(([eq]) => titleCasePattern(eq))
    const c = chrome()
    const option: EChartsOption = {
      ...baseOption(c),
      tooltip: { ...baseOption(c).tooltip, trigger: 'item' },
      grid: { left: 8, right: 16, top: 8, bottom: 4, containLabel: true },
      xAxis: valueAxis(c, { name: 'sets' }),
      yAxis: { ...categoryAxis(c, labels), inverse: true },
      series: [
        {
          type: 'bar',
          data: entries.map(([, count]) => count),
          barMaxWidth: 18,
          itemStyle: { color: c.plot, borderRadius: [0, 4, 4, 0] },
        },
      ],
    }
    return { option, entries }
  }, [data, appearance])

  return (
    <ChartCard
      title="Equipment mix"
      subtitle="Working sets per equipment type"
      isEmpty={entries.length === 0}
      emptyMessage="Log some sets to see your equipment mix."
      table={{
        columns: ['Equipment', 'Sets'],
        rows: entries.map(([eq, count]) => [titleCasePattern(eq), count]),
      }}
    >
      <Chart
        option={option}
        height={Math.max(160, entries.length * 30)}
        ariaLabel="Bar chart of working sets per equipment type"
      />
    </ChartCard>
  )
}

// ─────────────────────────────────────────────────── D-39 gap distribution
/** Days between sessions — how long the layoffs run. */
export function GapDistributionChart({ data }: { data: InsightsData }) {
  const appearance = useAppearanceKey()
  const buckets = ['0-1', '2', '3', '4-6', '7+']

  const { option, tally, gaps } = useMemo(() => {
    const times = data.sessions.map((s) => s.at).sort((a, b) => a - b)
    const gaps: number[] = []
    for (let i = 1; i < times.length; i += 1) {
      gaps.push(Math.round((times[i]! - times[i - 1]!) / 86_400_000))
    }
    const tally = new Array<number>(buckets.length).fill(0)
    for (const g of gaps) {
      const i = g <= 1 ? 0 : g === 2 ? 1 : g === 3 ? 2 : g <= 6 ? 3 : 4
      tally[i]! += 1
    }
    const c = chrome()
    const option: EChartsOption = {
      ...baseOption(c),
      tooltip: { ...baseOption(c).tooltip, trigger: 'item' },
      xAxis: categoryAxis(c, buckets),
      yAxis: valueAxis(c, { name: 'gaps' }),
      series: [
        {
          type: 'bar',
          data: tally,
          barMaxWidth: 40,
          itemStyle: { color: c.plot, borderRadius: [4, 4, 0, 0] },
        },
      ],
    }
    return { option, tally, gaps }
  }, [data, appearance])

  return (
    <ChartCard
      title="Gaps between sessions"
      subtitle="Days off between workouts"
      isEmpty={gaps.length < 2}
      emptyMessage="Log a few sessions to see how long your breaks run."
      table={{
        columns: ['Days off', 'Times'],
        rows: buckets.map((b, i) => [b, tally[i]!]),
      }}
    >
      <Chart option={option} ariaLabel="Histogram of days between sessions" />
    </ChartCard>
  )
}

// ─────────────────────────────────────────────────── B-16 stalled lifts
/**
 * Lifts whose estimated 1RM hasn't improved recently — what needs attention.
 * A table, not a chart: the useful output is a ranked list with numbers (§9).
 */
export function StalledLiftsChart({ data }: { data: InsightsData }) {
  const unit = data.profile.unitWeight
  const rows = data.exerciseSeries
    .map((series) => {
      const withE1rm = series.points.filter((p) => p.e1rmKg !== null)
      if (withE1rm.length < 2) return null
      const best = Math.max(...withE1rm.map((p) => p.e1rmKg!))
      const bestAt = withE1rm.find((p) => p.e1rmKg === best)!.at
      const weeksStalled = Math.round((Date.now() - bestAt) / (7 * 86_400_000))
      const current = withE1rm[withE1rm.length - 1]!.e1rmKg!
      return { name: series.name, best, current, weeksStalled }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null && r.weeksStalled >= 2)
    .sort((a, b) => b.weeksStalled - a.weeksStalled)
    .slice(0, 8)

  return (
    <ChartCard
      title="Stalled lifts"
      subtitle="No new e1RM in 2+ weeks"
      isEmpty={rows.length === 0}
      emptyMessage="Nothing stalled — every tracked lift set a recent best."
      table={{
        columns: ['Lift', 'Weeks', `Best (${unit})`],
        rows: rows.map((r) => [
          r.name,
          r.weeksStalled,
          Math.round(convertWeight(r.best, unit)).toLocaleString(),
        ]),
      }}
    >
      <div className="space-y-1.5 px-2 py-2">
        {rows.map((r) => (
          <div
            key={r.name}
            className="flex items-center justify-between gap-2 text-[13.5px]"
          >
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            <span className="tabular shrink-0 text-ink-muted">
              {Math.round(convertWeight(r.best, unit))} {unit}
            </span>
            <span
              className="tabular w-16 shrink-0 text-right font-semibold"
              style={{ color: 'var(--status-warning)' }}
            >
              {r.weeksStalled}w
            </span>
          </div>
        ))}
      </div>
    </ChartCard>
  )
}

// ─────────────────────────────────────────────────── overview summary + body
/** Headline numbers for the active filter scope. Stat tiles, not a chart. */
export function SummaryCard({
  data,
  rangeLabel,
}: {
  data: InsightsData
  rangeLabel: string
}) {
  const unit = data.profile.unitWeight
  return (
    <Card className="p-4">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
        Last {rangeLabel.toLowerCase()}
      </p>
      {/* A hero figure, not a one-bar chart. */}
      <p className="mt-1 text-[36px] font-bold leading-none tracking-tight">
        {displayWeight(data.totalVolumeKg, unit).toLocaleString()}
        <span className="ml-1.5 text-[15px] font-semibold text-ink-muted">
          {unit} lifted
        </span>
      </p>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
        <SummaryStat label="Workouts" value={String(data.workoutCount)} />
        <SummaryStat label="Sets" value={String(data.totalSets)} />
        {data.cardioSeconds > 0 && (
          <SummaryStat label="Cardio" value={formatDuration(data.cardioSeconds)} />
        )}
      </div>
    </Card>
  )
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[19px] font-bold leading-tight">{value}</p>
      <p className="text-[11.5px] text-ink-muted">{label}</p>
    </div>
  )
}

/** Placeholder card for the Body sub-tab's not-yet-plottable measurements. */
export function MoreBodyChartsCard() {
  return (
    <Card className="p-4">
      <h2 className="text-[15px] font-semibold tracking-tight">More body charts</h2>
      <p className="mt-1 text-[13px] text-ink-secondary">
        Body composition, circumferences, vitals, and sleep-vs-training charts arrive once
        there's enough logged data to plot. Log measurements under More to start filling
        them in.
      </p>
    </Card>
  )
}

function formatHour(hour: number): string {
  const period = hour < 12 ? 'a' : 'p'
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${twelve}${period}`
}

function titleCasePattern(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
