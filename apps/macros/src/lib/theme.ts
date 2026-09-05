import { createAppearance } from '@tracker-engine/ui'
import type { ThemePreset } from '@/domain/types'

export const THEME_PRESETS: { id: ThemePreset; label: string; swatch: string }[] = [
  { id: 'default', label: 'Warm', swatch: '#d2601a' },
  { id: 'slate', label: 'Slate', swatch: '#4f46c9' },
  { id: 'mono', label: 'Mono', swatch: '#1a1a1a' },
]

export const { applyAppearance, applyDefaultAppearance } = createAppearance({
  presets: THEME_PRESETS,
})

export { resolveScheme, type AppearanceSettings } from '@tracker-engine/ui'
