import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { EChartsOption } from 'echarts'
import { formatShortDay } from '@tracker-engine/core'
import { perWeek } from '@tracker-engine/body'
import * as repo from '@/data/repository'
import type { WeightUnit } from '@/domain/types'
import { bodyWeightFromKg } from '@/lib/units'
import { resolveRegionColor } from '@/lib/palette'
import { useAppearanceKey } from '@/lib/useColorScheme'
import { Chart } from '@/features/insights/Chart'
import { ChartCard } from '@/features/insights/ChartCard'
import { baseOption, categoryAxis, chartChrome, valueAxis } from '@tracker-engine/ui/charts'

export function BodyTrendCard({ unit }: { unit: WeightUnit }) {
  const appearance = useAppearanceKey()
  const data = useLiveQuery(() => repo.bodyweightTrend(), [])
  const trend = data?.trend ?? []
  const show = (kg: number) => bodyWeightFromKg(kg, unit)

  const option = useMemo((): EChartsOption => {
    const c = { ...chartChrome(), plot: resolveRegionColor('chest') }
    return {
      ...baseOption(c),
      xAxis: categoryAxis(
        c,
        trend.map((point) => formatShortDay(point.day)),
      ),
      yAxis: { ...valueAxis(c), scale: true, minInterval: 1 },
      series: [
        {
          name: 'Weighed',
          type: 'scatter',
          symbolSize: 5,
          itemStyle: { color: c.plot, opacity: 0.55 },
          data: trend.map((point) => show(point.kg)),
        },
        {
          name: 'Trend',
          type: 'line',
          smooth: true,
          showSymbol: false,
          lineStyle: { color: c.plot, width: 2.5 },
          itemStyle: { color: c.plot },
          data: trend.map((point) => show(point.trendKg)),
        },
      ],
    }
  }, [trend, unit, appearance])

  if (!data) return null
  const latest = trend[trend.length - 1]

  return (
    <ChartCard
      title="Bodyweight trend"
      subtitle={
        latest
          ? [
              `${show(latest.trendKg)} ${unit} trend`,
              data.kgPerWeek === null ? null : perWeek(data.kgPerWeek, unit),
            ]
              .filter(Boolean)
              .join(' · ')
          : 'Smoothed, so one heavy morning doesn’t move it'
      }
      isEmpty={trend.length === 0}
      emptyMessage="Log your bodyweight to see its trend."
      table={{
        columns: ['Day', `Weighed (${unit})`, `Trend (${unit})`],
        rows: trend.map((point) => [point.day, show(point.kg), show(point.trendKg)]),
      }}
    >
      <Chart option={option} ariaLabel="Bodyweight readings and their smoothed trend" />
    </ChartCard>
  )
}
