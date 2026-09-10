import type { EChartsOption } from 'echarts'
import { formatVolume, litresFromMl, volumeFromMl, type VolumeUnit } from '@tracker-engine/core'
import { Chart, ChartCard } from '@tracker-engine/ui/charts'
import { shortDay, useChartTokens } from './chartTokens'
import type { WaterDay } from './useInsightsData'

/**
 * Water per day, against the target when there is one.
 *
 * Days with nothing recorded are drawn as a gap, not as zero — the same rule the fibre chart follows,
 * and for the same reason: "didn't log it" and "drank none" are different facts, and a run of zeroes
 * would make the first look like the second.
 *
 * The unit is the user's. Storage is millilitres, so the axis converts once at the edge rather than
 * letting a preference into the data.
 */
export function WaterChart({
  days,
  targetMl,
  unit,
}: {
  days: WaterDay[]
  targetMl: number | null
  unit: VolumeUnit
}) {
  const tokens = useChartTokens()
  const logged = days.filter((day) => day.ml !== null)
  const toDisplay = (ml: number) => (unit === 'floz' ? volumeFromMl(ml, 'floz') : litresFromMl(ml))
  const axisSuffix = unit === 'floz' ? 'oz' : 'L'

  const mean =
    logged.length === 0 ? null : logged.reduce((sum, day) => sum + (day.ml ?? 0), 0) / logged.length
  const hit = targetMl === null ? 0 : logged.filter((day) => (day.ml ?? 0) >= targetMl).length

  const option: EChartsOption = {
    animation: false,
    grid: { left: 40, right: 12, top: 12, bottom: 24 },
    xAxis: {
      type: 'category',
      data: days.map((day) => shortDay(day.day)),
      axisLine: { lineStyle: { color: tokens.axis } },
      axisLabel: { color: tokens.inkMuted, fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: tokens.gridline } },
      axisLabel: {
        color: tokens.inkMuted,
        fontSize: 10,
        formatter: (value: number) => `${unit === 'floz' ? Math.round(value) : value}${axisSuffix}`,
      },
    },
    tooltip: { trigger: 'axis' },
    series: [
      {
        type: 'bar',
        barMaxWidth: 14,
        data: days.map((day) =>
          day.ml === null
            ? null
            : {
                value: toDisplay(day.ml),
                itemStyle: {
                  color:
                    // Resolved hex, not a CSS variable: ECharts paints to canvas and cannot read one.
                    targetMl !== null && day.ml >= targetMl ? tokens.on : tokens.carbs,
                },
              },
        ),
        ...(targetMl === null
          ? {}
          : {
              markLine: {
                silent: true,
                symbol: 'none',
                label: {
                  formatter: formatVolume(targetMl, unit),
                  color: tokens.inkMuted,
                  fontSize: 9,
                },
                lineStyle: { color: tokens.on, type: 'dashed' },
                data: [{ yAxis: toDisplay(targetMl) }],
              },
            }),
      },
    ],
  }

  return (
    <ChartCard
      title="Water"
      subtitle={
        mean === null
          ? undefined
          : `${formatVolume(Math.round(mean), unit)} a day across ${logged.length} logged day${
              logged.length === 1 ? '' : 's'
            }` + (targetMl === null ? '' : ` · target hit on ${hit}`)
      }
      isEmpty={logged.length === 0}
      emptyMessage="Nothing logged yet — the glass on Today is where it goes in."
      table={{
        columns: ['Day', `Water (${unit === 'floz' ? 'fl oz' : 'ml'})`],
        rows: days.map((day) => [
          day.day,
          day.ml === null ? 'not logged' : Math.round(unit === 'floz' ? toDisplay(day.ml) : day.ml),
        ]),
      }}
    >
      <Chart option={option} ariaLabel="Water per day against the daily target" />
    </ChartCard>
  )
}
