import { useAppearanceKey } from '@tracker-engine/ui'

export {
  resolveColor,
  useAppearanceKey,
  useColorScheme,
  type ColorScheme,
} from '@tracker-engine/ui'

/** Chart colours resolved from this app's own tokens, re-read on appearance change. */
export function useChartTokens(): Record<string, string> {
  useAppearanceKey()
  if (typeof document === 'undefined') return {}
  const style = getComputedStyle(document.documentElement)
  const read = (name: string) => style.getPropertyValue(name).trim()
  return {
    accent: read('--accent'),
    ink: read('--text-primary'),
    inkMuted: read('--text-muted'),
    gridline: read('--gridline'),
    axis: read('--axis'),
    pos: read('--div-pos'),
    neg: read('--div-neg'),
  }
}
