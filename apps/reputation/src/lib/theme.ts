import { createAppearance } from '@tracker-engine/ui'

export const THEME_PRESETS = [
  { id: 'default', label: 'Default', swatch: '#2a78d6' },
  { id: 'slate', label: 'Slate', swatch: '#4f46c9' },
  { id: 'forest', label: 'Forest', swatch: '#1f7a47' },
  { id: 'ocean', label: 'Ocean', swatch: '#0f7a86' },
  { id: 'sunset', label: 'Sunset', swatch: '#c1521b' },
  { id: 'crimson', label: 'Crimson', swatch: '#b0243c' },
  { id: 'mono', label: 'Mono', swatch: '#1a1a1a' },
] as const

export type ThemeId = (typeof THEME_PRESETS)[number]['id']

export const { applyAppearance, applyDefaultAppearance } = createAppearance({
  presets: THEME_PRESETS,
})

export { resolveScheme, type AppearanceSettings, type ColorSchemePreference } from '@tracker-engine/ui'
export { accentWash, contrastingInk, contrastRatio, ensureContrast, parseHex, toHex } from '@tracker-engine/core'
