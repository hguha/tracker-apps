import type { EChartsOption } from 'echarts'
import { resolveToken } from '@/lib/palette'

export interface ChartChrome {
  ink: string
  inkSecondary: string
  muted: string
  gridline: string
  axis: string
  surface: string
  // Single-series mark color = categorical slot 1, not the accent (which can collide with region hues).
  plot: string
}

export function chrome(): ChartChrome {
  return {
    ink: resolveToken('--text-primary', '#0b0b0b'),
    inkSecondary: resolveToken('--text-secondary', '#52514e'),
    muted: resolveToken('--text-muted', '#898781'),
    gridline: resolveToken('--gridline', '#e1e0d9'),
    axis: resolveToken('--axis', '#c3c2b7'),
    surface: resolveToken('--surface-1', '#fcfcfb'),
    plot: resolveToken('--region-chest', '#2a78d6'),
  }
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
      // Larger than the mark, so a fingertip lands somewhere useful.
      axisPointer: { type: 'line', lineStyle: { color: c.axis, width: 1 } },
    },
  }
}

export function categoryAxis(c: ChartChrome, data: string[]) {
  return {
    type: 'category' as const,
    data,
    axisLine: { lineStyle: { color: c.axis, width: 1 } },
    axisTick: { show: false },
    axisLabel: { color: c.muted, fontSize: 11 },
  }
}

export function valueAxis(c: ChartChrome, opts: { name?: string } = {}) {
  return {
    type: 'value' as const,
    name: opts.name,
    nameTextStyle: { color: c.muted, fontSize: 11 },
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: c.muted, fontSize: 11 },
    // Solid hairlines. Dashing reads as "projection" when it's just a grid.
    splitLine: { lineStyle: { color: c.gridline, width: 1, type: 'solid' as const } },
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
