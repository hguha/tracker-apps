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
import { Chart } from './Chart'
import { ChartCard } from './ChartCard'
import { baseOption, categoryAxis, chrome, valueAxis } from './chartTheme'
import { REP_BUCKETS, type InsightsData } from './useInsightsData'
import { useAppearanceKey } from '@/lib/useColorScheme'
import { regionVar, resolveRegionColor, resolveToken } from '@/lib/palette'
import { REGION_LABELS, REGIONS, type Region } from '@/domain/types'
import { formatDuration, weightFromKg } from '@/lib/units'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function weekLabels(weeks: string[]): string[] {
  return weeks.map((week) => format(new Date(week), 'MMM d'))
}

// ─────────────────────────────────────────────────────────── A-4 volume trend

/** Total volume per week, with a moving average as the emphasis line. */
export function WeeklyVolumeChart({ data }: { data: InsightsData }) {
  const appearance = useAppearanceKey()
  const unit = data.profile.unitWeight
  const labels = weekLabels(data.weeks)

  const points = data.weeks.map((week) =>
    Math.round(weightFromKg(data.volumeByWeek.get(week) ?? 0, unit)),
  )
  const movingAverage = points.map((_, index) => {
    const window = points.slice(Math.max(0, index - 3), index + 1)
    return Math.round(window.reduce((a, b) => a + b, 0) / window.length)
  })

  const option = useMemo<EChartsOption>(() => {
    const c = chrome()
    return {
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
  }, [labels, points, movingAverage, unit, appearance])

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
          Math.round(weightFromKg(entry.value, unit)).toLocaleString(),
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
  const labels = weekLabels(data.weeks)

  const activeRegions = REGIONS.filter(
    (region) => (data.volumeByRegion.get(region) ?? 0) > 0,
  )

  const seriesData = activeRegions.map((region) => ({
    region,
    values: data.weeks.map((week) =>
      Math.round(weightFromKg(data.regionVolumeByWeek.get(week)?.get(region) ?? 0, unit)),
    ),
  }))

  const option = useMemo<EChartsOption>(() => {
    const c = chrome()
    return {
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
  }, [labels, seriesData, appearance])

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
 * Estimated 1RM over time for one lift, as **emphasis**: the selected lift in
 * the accent hue, nothing else competing. Eight categorical colors here would
 * bury the one line the reader came for.
 */
export function StrengthProgressionChart({
  data,
  selectedExerciseId,
  onSelectExercise,
}: {
  data: InsightsData
  selectedExerciseId: string | null
  onSelectExercise: (exerciseId: string) => void
}) {
  const appearance = useAppearanceKey()
  const unit = data.profile.unitWeight

  const candidates = data.exerciseSeries.filter((series) => series.points.length >= 2)
  const active =
    candidates.find((series) => series.exerciseId === selectedExerciseId) ??
    candidates[0]

  const option = useMemo<EChartsOption>(() => {
    const c = chrome()
    const points = (active?.points ?? []).filter((p) => p.e1rmKg !== null)
    return {
      ...baseOption(c),
      xAxis: categoryAxis(c, points.map((p) => format(p.at, 'MMM d'))),
      yAxis: valueAxis(c),
      series: [
        {
          name: `e1RM (${unit})`,
          type: 'line',
          data: points.map((p) => Math.round(weightFromKg(p.e1rmKg!, unit))),
          symbol: 'circle',
          symbolSize: 7,
          lineStyle: { width: 2, color: c.plot },
          itemStyle: { color: c.plot, borderColor: c.surface, borderWidth: 2 },
        },
      ],
    }
  }, [active, unit, appearance])

  return (
    <ChartCard
      title="Strength progression"
      subtitle={
        active ? `${active.name} — estimated 1RM in ${unit}` : `Estimated 1RM in ${unit}`
      }
      isEmpty={candidates.length === 0}
      emptyMessage="Log the same lift on two different days to see progression."
      table={{
        columns: ['Date', `e1RM (${unit})`],
        rows: [...(active?.points ?? [])]
          .filter((p) => p.e1rmKg !== null)
          .reverse()
          .map((p) => [
            format(p.at, 'MMM d, yyyy'),
            Math.round(weightFromKg(p.e1rmKg!, unit)).toLocaleString(),
          ]),
      }}
    >
      {/* An exercise switcher, not a filter — it selects which series is shown. */}
      <div className="mb-1 flex gap-1.5 overflow-x-auto px-2 pb-1">
        {candidates.slice(0, 10).map((series) => (
          <button
            key={series.exerciseId}
            onClick={() => onSelectExercise(series.exerciseId)}
            className={[
              'shrink-0 rounded-full border px-2.5 py-1 text-[12px] font-medium',
              active?.exerciseId === series.exerciseId
                ? 'border-accent bg-accent-wash text-accent'
                : 'border-line text-ink-secondary',
            ].join(' ')}
          >
            {series.name}
          </button>
        ))}
      </div>
      <Chart option={option} ariaLabel="Line chart of estimated one-rep max over time" />
    </ChartCard>
  )
}

// ──────────────────────────────────────────────────── B-9 top-set weight

/** The heaviest working set per session for one lift. */
export function TopSetChart({
  data,
  selectedExerciseId,
}: {
  data: InsightsData
  selectedExerciseId: string | null
}) {
  const appearance = useAppearanceKey()
  const unit = data.profile.unitWeight

  const active =
    data.exerciseSeries.find((s) => s.exerciseId === selectedExerciseId) ??
    data.exerciseSeries[0]
  const points = (active?.points ?? []).filter((p) => p.topSetKg !== null)

  const option = useMemo<EChartsOption>(() => {
    const c = chrome()
    return {
      ...baseOption(c),
      xAxis: categoryAxis(c, points.map((p) => format(p.at, 'MMM d'))),
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
  }, [points, unit, appearance])

  return (
    <ChartCard
      title="Top set"
      subtitle={active ? `${active.name} — heaviest set per session` : 'Heaviest set'}
      isEmpty={points.length < 2}
      emptyMessage="Log a weighted lift twice to see how the top set moves."
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

  const counts = REP_BUCKETS.map((bucket) => data.repBuckets.get(bucket) ?? 0)
  const total = counts.reduce((a, b) => a + b, 0)

  const option = useMemo<EChartsOption>(() => {
    const c = chrome()
    // Ordinal ramp: the lightest step still clears 2:1 against the surface.
    const ramp = [
      resolveToken('--seq-300', '#6da7ec'),
      resolveToken('--seq-400', '#3987e5'),
      resolveToken('--seq-500', '#256abf'),
      resolveToken('--seq-600', '#184f95'),
      resolveToken('--seq-700', '#0d366b'),
    ]
    return {
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
  }, [counts, appearance])

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
  const labels = weekLabels(data.weeks)
  const counts = data.weeks.map((week) => data.workoutsByWeek.get(week) ?? 0)

  const option = useMemo<EChartsOption>(() => {
    const c = chrome()
    return {
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
  }, [labels, counts, appearance])

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
  const profileStart = data.profile.weekStartsOn

  // Rotate so the week starts where the user says it does.
  const order = Array.from({ length: 7 }, (_, i) => (i + profileStart) % 7)
  const labels = order.map((day) => DAY_LABELS[day]!)
  const counts = order.map((day) => data.dayOfWeekCounts[day]!)

  const option = useMemo<EChartsOption>(() => {
    const c = chrome()
    return {
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
  }, [labels, counts, appearance])

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

  const points = data.sessions
    .filter((s) => s.durationSeconds !== null && s.volumeKg > 0)
    .map((s) => [
      Math.round(s.durationSeconds! / 60),
      Math.round(weightFromKg(s.volumeKg, unit)),
      s.at,
    ])

  const option = useMemo<EChartsOption>(() => {
    const c = chrome()
    return {
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
  }, [points, unit, appearance])

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
      <Chart option={option} ariaLabel="Scatter plot of session volume against duration" />
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

  const raw = entries.map((e) => weightFromKg(e.value, unit, 0.1))
  const average = raw.map((_, index) => {
    const window = raw.slice(Math.max(0, index - 6), index + 1)
    return Number((window.reduce((a, b) => a + b, 0) / window.length).toFixed(1))
  })
  const labels = entries.map((e) => format(e.at, 'MMM d'))

  const option = useMemo<EChartsOption>(() => {
    const c = chrome()
    return {
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
  }, [labels, raw, average, appearance])

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

/** Region colors for a chart that needs them outside a series definition. */
export function regionColor(region: Region): string {
  return regionVar(region)
}
