import { createAppearance, sharedThemes } from '@tracker-engine/ui'
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
  ...sharedThemes('slate', 'forest', 'ocean', 'crimson', 'mono'),
]

export const { applyAppearance, applyDefaultAppearance } = createAppearance({
  presets: THEME_PRESETS,
})
