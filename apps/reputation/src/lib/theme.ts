import { createAppearance, SHARED_THEME_PRESETS } from '@tracker-engine/ui'

export const THEME_PRESETS = [
  { id: 'default', label: 'Default', swatch: '#2a78d6' },
  ...SHARED_THEME_PRESETS,
] as const

export type ThemeId = (typeof THEME_PRESETS)[number]['id']

export const { applyAppearance, applyDefaultAppearance } = createAppearance({
  presets: THEME_PRESETS,
})

export { resolveScheme, type AppearanceSettings, type ColorSchemePreference } from '@tracker-engine/ui'
export { accentWash, contrastingInk, contrastRatio, ensureContrast, parseHex, toHex } from '@tracker-engine/core'
