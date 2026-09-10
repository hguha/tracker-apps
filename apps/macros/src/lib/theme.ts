import { createAppearance } from '@tracker-engine/ui'
import type { ThemePreset } from '@/domain/types'

/**
 * `default` is this app's own palette; the rest come from @tracker-engine/ui/styles/themes.css and are
 * shared with REPutation.
 *
 * `sunset` is absent on purpose. It and the old "Warm" default were two hues apart — close enough that
 * switching between them looked like the picker had done nothing, which is worse than either being the
 * wrong colour. The warmer of the two is now `default`, and offering both would put a duplicate in a
 * list of seven. The swatches are the light-mode accents, so a swatch is the colour you get.
 */
export const THEME_PRESETS: { id: ThemePreset; label: string; swatch: string }[] = [
  { id: 'default', label: 'Sunset', swatch: '#a84818' },
  { id: 'slate', label: 'Slate', swatch: '#4a41c4' },
  { id: 'forest', label: 'Forest', swatch: '#1c6d40' },
  { id: 'ocean', label: 'Ocean', swatch: '#0c6f79' },
  { id: 'crimson', label: 'Crimson', swatch: '#a81f37' },
  { id: 'mono', label: 'Mono', swatch: '#171717' },
]

export const { applyAppearance, applyDefaultAppearance } = createAppearance({
  presets: THEME_PRESETS,
})

export { resolveScheme, type AppearanceSettings } from '@tracker-engine/ui'
