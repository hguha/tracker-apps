import { displayWeight, weightFromKg } from '@/lib/units'
import { Chart } from './Chart'
import { ChartCard } from './ChartCard'
import { baseOption, categoryAxis, chrome, valueAxis } from './chartTheme'
import { type InsightsData, REP_BUCKETS } from './useInsightsData'
import { resolveToken } from '@/lib/palette'
import { useAppearanceKey } from '@/lib/useColorScheme'
import { format } from 'date-fns'
import { type EChartsOption } from 'echarts'
import { useMemo } from 'react'
import { PickExerciseCard, useLiftSubject } from './chartShared'

export function StrengthProgressionChart({
  data,
  activeExerciseId,
}: {
  data: InsightsData
  activeExerciseId: string | null
}) {
  const appearance = useAppearanceKey()
  const unit = data.profile.unitWeight

  const subject = useLiftSubject(data, activeExerciseId)
  const active = subject

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
          data: points.map((p) => displayWeight(p.e1rmKg!, unit)),
          symbol: 'circle',
          symbolSize: 7,
          lineStyle: { width: 2, color: c.plot },
          itemStyle: { color: c.plot, borderColor: c.surface, borderWidth: 2 },
        },
      ],
    }
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
      subtitle={`${active.label} — estimated 1RM in ${unit}`}
      isEmpty={active.points.filter((p) => p.e1rmKg !== null).length < 2}
      emptyMessage="Log this lift on two different days to see progression."
      table={{
        columns: ['Date', `e1RM (${unit})`],
        rows: [...active.points]
          .filter((p) => p.e1rmKg !== null)
          .reverse()
          .map((p) => [
            format(p.at, 'MMM d, yyyy'),
            displayWeight(p.e1rmKg!, unit).toLocaleString(),
          ]),
      }}
    >
      {active.toggle}
      <Chart option={option} ariaLabel="Line chart of estimated one-rep max over time" />
    </ChartCard>
  )
}

export function TopSetChart({
  data,
  activeExerciseId,
}: {
  data: InsightsData
  activeExerciseId: string | null
}) {
  const appearance = useAppearanceKey()
  const unit = data.profile.unitWeight

  const active = useLiftSubject(data, activeExerciseId)

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
      subtitle={`${active.label} — heaviest set per session`}
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
      {active.toggle}
      <Chart option={option} ariaLabel="Line chart of heaviest set per session" />
    </ChartCard>
  )
}

// C-27

// Buckets are ordered, so a sequential ramp is used rather than categorical hues.

export function RepRangeChart({ data }: { data: InsightsData }) {
  const appearance = useAppearanceKey()

  const { option, counts, total } = useMemo(() => {
    const counts = REP_BUCKETS.map((bucket) => data.repBuckets.get(bucket) ?? 0)
    const total = counts.reduce((a, b) => a + b, 0)
    const c = chrome()
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

// D-34

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
    const values = points.map((p) => displayWeight(p.volumeKg, unit))
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

// C-25

export function StalledLiftsChart({ data }: { data: InsightsData }) {
  // Backed by the PR records (max_weight / e1RM / reps), so a lift that set any PR
  // recently is never "stalled" — this agrees with the log's PR toast by construction.
  const rows = data.stalledLifts.slice(0, 8)

  return (
    <ChartCard
      title="Stalled lifts"
      subtitle="No new PR (weight, e1RM, or reps) in 2+ weeks"
      isEmpty={rows.length === 0}
      emptyMessage="Nothing stalled — every tracked lift set a recent PR."
      table={{
        columns: ['Lift', 'Weeks since PR'],
        rows: rows.map((r) => [r.name, r.weeksStalled]),
      }}
    >
      <div className="space-y-1.5 px-2 py-2">
        {rows.map((r) => (
          <div
            key={r.exerciseId}
            className="flex items-center justify-between gap-2 text-[13.5px]"
          >
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            <span
              className="tabular w-24 shrink-0 text-right font-semibold"
              style={{ color: 'var(--status-warning)' }}
            >
              {r.weeksStalled}w since PR
            </span>
          </div>
        ))}
      </div>
    </ChartCard>
  )
}

// ─────────────────────────────────────────────────── overview summary + body
/** Stat tiles, not a chart. */
