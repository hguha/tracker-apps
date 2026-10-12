import type { EChartsOption } from 'echarts'
import { resolveColor, useAppearanceKey } from '../useColorScheme'

export interface ChartChrome {
  ink: string
  inkSecondary: string
  inkMuted: string
  gridline: string
  axis: string
  surface: string
}

export const chartChrome = (): ChartChrome => ({
  ink: resolveColor('var(--text-primary)'),
  inkSecondary: resolveColor('var(--text-secondary)'),
  inkMuted: resolveColor('var(--text-muted)'),
  gridline: resolveColor('var(--gridline)'),
  axis: resolveColor('var(--axis)'),
  surface: resolveColor('var(--surface-1)'),
})

export function useChartChrome(): ChartChrome {
  useAppearanceKey()
  return chartChrome()
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function baseOption(c: ChartChrome): EChartsOption {
  return {
    animation: !prefersReducedMotion(),
    grid: { left: 8, right: 12, top: 12, bottom: 4, containLabel: true },
    textStyle: {
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      color: c.inkSecondary,
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: c.surface,
      borderColor: c.gridline,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: c.ink, fontSize: 12 },
      axisPointer: { type: 'line', lineStyle: { color: c.axis, width: 1 } },
    },
  }
}

interface CategoryLabel {
  fontSize?: number
  rotate?: number
  interval?: number | 'auto'
  formatter?: string | ((value: string) => string)
}

interface ValueLabel {
  fontSize?: number
  formatter?: string | ((value: number) => string)
}

interface ValueAxisOptions {
  name?: string
  minInterval?: number
  scale?: boolean
  min?: number | ((extent: { min: number }) => number)
  max?: number | ((extent: { max: number }) => number)
  gridlines?: boolean
  axisLabel?: ValueLabel
}

export const categoryAxis = (c: ChartChrome, data: string[], axisLabel: CategoryLabel = {}) => ({
  type: 'category' as const,
  data,
  axisLine: { lineStyle: { color: c.axis, width: 1 } },
  axisTick: { show: false },
  axisLabel: { color: c.inkMuted, fontSize: 11, ...axisLabel },
})

export const valueAxis = (
  c: ChartChrome,
  { gridlines = true, axisLabel = {}, name, ...rest }: ValueAxisOptions = {},
) => ({
  type: 'value' as const,
  ...rest,
  ...(name !== undefined && { name, nameTextStyle: { color: c.inkMuted, fontSize: 10 } }),
  axisLine: { show: false },
  axisTick: { show: false },
  splitLine: gridlines
    ? { lineStyle: { color: c.gridline, width: 1, type: 'solid' as const } }
    : { show: false },
  axisLabel: { color: c.inkMuted, fontSize: 11, ...axisLabel },
})

export const chartLegend = (c: ChartChrome) => ({
  textStyle: { color: c.inkMuted, fontSize: 10 },
  top: 0,
  itemHeight: 8,
})
