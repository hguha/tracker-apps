import { resolveColor, useAppearanceKey } from '@tracker-engine/ui'

/**
 * Chart colours resolved to concrete hex. ECharts renders to canvas and cannot read CSS
 * variables, so every option object must depend on `useAppearanceKey()` to repaint when the
 * theme or light/dark scheme changes.
 */
export function useChartTokens() {
  useAppearanceKey()
  return {
    accent: resolveColor('var(--accent)'),
    ink: resolveColor('var(--text-primary)'),
    inkMuted: resolveColor('var(--text-muted)'),
    gridline: resolveColor('var(--gridline)'),
    axis: resolveColor('var(--axis)'),
    protein: resolveColor('var(--macro-protein)'),
    carbs: resolveColor('var(--macro-carbs)'),
    fat: resolveColor('var(--macro-fat)'),
    over: resolveColor('var(--target-over)'),
    on: resolveColor('var(--target-on)'),
  }
}

export type ChartTokens = ReturnType<typeof useChartTokens>

/** Axis labels are `yyyy-MM-dd`; charts only have room for the day and month. */
export const shortDay = (day: string): string => day.slice(5).replace('-', '/')

interface CategoryLabel {
  fontSize?: number
  rotate?: number
  interval?: number | 'auto'
}

interface ValueLabel {
  formatter?: string | ((value: number) => string)
}

interface ValueAxisOptions {
  name?: string
  minInterval?: number
  scale?: boolean
  min?: (extent: { min: number }) => number
  max?: (extent: { max: number }) => number
  gridlines?: boolean
  axisLabel?: ValueLabel
}

export const categoryAxis = (tokens: ChartTokens, data: string[], axisLabel: CategoryLabel = {}) => ({
  type: 'category' as const,
  data,
  axisLine: { lineStyle: { color: tokens.axis } },
  axisLabel: { color: tokens.inkMuted, fontSize: 10, ...axisLabel },
})

export const valueAxis = (
  tokens: ChartTokens,
  { gridlines = true, axisLabel = {}, name, ...rest }: ValueAxisOptions = {},
) => ({
  type: 'value' as const,
  ...rest,
  ...(name !== undefined && { name, nameTextStyle: { color: tokens.inkMuted, fontSize: 9 } }),
  splitLine: gridlines ? { lineStyle: { color: tokens.gridline } } : { show: false },
  axisLabel: { color: tokens.inkMuted, fontSize: 10, ...axisLabel },
})

export const chartLegend = (tokens: ChartTokens) => ({
  textStyle: { color: tokens.inkMuted, fontSize: 10 },
  top: 0,
  itemHeight: 8,
})

export const targetMark = (points: number) =>
  points === 1
    ? { showSymbol: true, symbol: 'rect', symbolSize: [18, 2] as [number, number] }
    : { showSymbol: false }
