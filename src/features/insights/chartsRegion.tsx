import { displayWeight } from '@/lib/units'
import { Chart } from './Chart'
import { ChartCard } from './ChartCard'
import { baseOption, categoryAxis, chrome, valueAxis } from './chartTheme'
import { type InsightsData } from './useInsightsData'
import { MOVEMENT_PATTERNS, REGIONS, REGION_LABELS } from '@/domain/types'
import { humanizeSlug } from '@/lib/labels'
import { regionVar, resolveRegionColor } from '@/lib/palette'
import { useAppearanceKey } from '@/lib/useColorScheme'
import { type EChartsOption } from 'echarts'
import { useMemo } from 'react'
import { weekLabels } from './chartShared'

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
          displayWeight(entry.value, unit).toLocaleString(),
        ]),
      }}
    >
      <div className="px-2 pb-1 pt-2">
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

// C-21

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
        displayWeight(data.regionVolumeByWeek.get(week)?.get(region) ?? 0, unit),
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

// A-5

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

// B-8

// The picked lift for the single-lift charts: its points and display label.

export function PatternCoverageChart({ data }: { data: InsightsData }) {
  const appearance = useAppearanceKey()

  const { option, entries } = useMemo(() => {
    const entries = MOVEMENT_PATTERNS.map((pattern) => ({
      pattern,
      count: data.setsByPattern.get(pattern) ?? 0,
    })).filter((e) => e.count > 0)
    const labels = entries.map((e) => humanizeSlug(e.pattern))
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
      title="Push / pull balance"
      subtitle="Working sets by movement type"
      isEmpty={entries.length === 0}
      emptyMessage="Log some sets to see how your pushing and pulling compare."
      table={{
        columns: ['Movement', 'Sets'],
        rows: entries.map((e) => [humanizeSlug(e.pattern), e.count]),
      }}
    >
      <Chart
        option={option}
        height={Math.max(160, entries.length * 30)}
        ariaLabel="Bar chart of working sets by movement type"
      />
    </ChartCard>
  )
}

// C-26

export function EquipmentMixChart({ data }: { data: InsightsData }) {
  const appearance = useAppearanceKey()

  const { option, entries } = useMemo(() => {
    const entries = [...data.setsByEquipment.entries()]
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
    const labels = entries.map(([eq]) => humanizeSlug(eq))
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
        rows: entries.map(([eq, count]) => [humanizeSlug(eq), count]),
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

// D-39
