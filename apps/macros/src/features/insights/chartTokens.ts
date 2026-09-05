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

/** Axis labels are `yyyy-MM-dd`; charts only have room for the day and month. */
export const shortDay = (day: string): string => day.slice(5).replace('-', '/')
