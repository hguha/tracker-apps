import { createAppearance, sharedThemes } from '@tracker-engine/ui'
import type { ThemePreset } from '@/domain/types'

export const THEME_PRESETS: { id: ThemePreset; label: string; swatch: string }[] = [
  { id: 'default', label: 'Green', swatch: '#0f8a5f' },
  ...sharedThemes('slate', 'mono'),
]

export const { applyAppearance, applyDefaultAppearance } = createAppearance({
  presets: THEME_PRESETS,
})

export { resolveScheme, type AppearanceSettings } from '@tracker-engine/ui'
