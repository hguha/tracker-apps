import { createAppearance } from '@tracker-engine/ui'
import type { ThemePreset } from '@/domain/types'

// `default` is this app's own palette (warm, appetite orange); the rest come from
// @tracker-engine/ui/styles/themes.css and are shared with REPutation.
export const THEME_PRESETS: { id: ThemePreset; label: string; swatch: string }[] = [
  { id: 'default', label: 'Warm', swatch: '#d2601a' },
  { id: 'slate', label: 'Slate', swatch: '#4f46c9' },
  { id: 'forest', label: 'Forest', swatch: '#1f7a47' },
  { id: 'ocean', label: 'Ocean', swatch: '#0f7a86' },
  { id: 'sunset', label: 'Sunset', swatch: '#c1521b' },
  { id: 'crimson', label: 'Crimson', swatch: '#b0243c' },
  { id: 'mono', label: 'Mono', swatch: '#1a1a1a' },
]

export const { applyAppearance, applyDefaultAppearance } = createAppearance({
  presets: THEME_PRESETS,
})

export { resolveScheme, type AppearanceSettings } from '@tracker-engine/ui'
