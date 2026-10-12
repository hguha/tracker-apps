import { resolveColor } from '@tracker-engine/ui'
import { useChartChrome } from '@tracker-engine/ui/charts'

export { categoryAxis, chartLegend, valueAxis } from '@tracker-engine/ui/charts'

/**
 * Chart colours resolved to concrete hex. ECharts renders to canvas and cannot read CSS
 * variables, so every option object must depend on `useAppearanceKey()` to repaint when the
 * theme or light/dark scheme changes.
 */
export function useChartTokens() {
  return {
    ...useChartChrome(),
    accent: resolveColor('var(--accent)'),
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

export const targetMark = (points: number) =>
  points === 1
    ? { showSymbol: true, symbol: 'rect', symbolSize: [18, 2] as [number, number] }
    : { showSymbol: false }
