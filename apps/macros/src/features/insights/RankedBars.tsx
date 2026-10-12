import type { EChartsOption } from 'echarts'
import { Chart } from '@tracker-engine/ui/charts'
import { categoryAxis, useChartTokens, valueAxis } from './chartTokens'

export function RankedBars({
  labels,
  values,
  ariaLabel,
  name,
  gridLeft,
  gridRight = 30,
  labelFontSize = 10,
  barMaxWidth = 14,
  barLabel,
}: {
  labels: string[]
  values: number[]
  ariaLabel: string
  name?: string
  gridLeft: number
  gridRight?: number
  labelFontSize?: number
  barMaxWidth?: number
  barLabel?: (index: number) => string
}) {
  const tokens = useChartTokens()
  const last = values.length - 1

  const option: EChartsOption = {
    animation: false,
    grid: { left: gridLeft, right: gridRight, top: 8, bottom: 24 },
    xAxis: valueAxis(tokens),
    yAxis: categoryAxis(tokens, [...labels].reverse(), { fontSize: labelFontSize }),
    tooltip: { trigger: 'axis' },
    series: [
      {
        name,
        type: 'bar',
        barMaxWidth,
        itemStyle: { color: tokens.accent },
        ...(barLabel && {
          label: {
            show: true,
            position: 'right',
            color: tokens.inkMuted,
            fontSize: 10,
            formatter: (params: { dataIndex: number }) => barLabel(last - params.dataIndex),
          },
        }),
        data: [...values].reverse(),
      },
    ],
  }

  return <Chart option={option} ariaLabel={ariaLabel} />
}
