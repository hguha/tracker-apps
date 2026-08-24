// Theme application. Two axes (data-theme preset + data-scheme light/dark), exactly
// like REPutation but leaner: three presets, no custom-accent picker. A pure leaf —
// it touches only <html> dataset, so the caller drives any platform side-effects.

import type { ColorSchemePreference, ThemePreset } from '@/domain/types'

export const THEME_PRESETS: { id: ThemePreset; label: string; swatch: string }[] = [
  { id: 'default', label: 'Green', swatch: '#0f8a5f' },
  { id: 'slate', label: 'Slate', swatch: '#4f46c9' },
  { id: 'mono', label: 'Mono', swatch: '#1a1a1a' },
]

const KNOWN = new Set<string>(THEME_PRESETS.map((p) => p.id))

function resolveTheme(theme: string): ThemePreset {
  return KNOWN.has(theme) ? (theme as ThemePreset) : 'default'
}

export function resolveScheme(preference: ColorSchemePreference): 'light' | 'dark' {
  if (preference !== 'system') return preference
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export interface AppearanceSettings {
  // Loosely typed: it round-trips through storage where another build could have
  // written an unknown name. resolveTheme falls back rather than leaving it unset.
  theme: string
  colorScheme: ColorSchemePreference
}

// Applied at module load before any profile exists, so the sign-in screen's
// accent-colored elements aren't transparent until sign-in.
export function applyDefaultAppearance(): void {
  applyAppearance({ theme: 'default', colorScheme: 'system' })
}

// Returns the resolved scheme so the caller can drive platform side-effects.
export function applyAppearance(settings: AppearanceSettings): 'light' | 'dark' | null {
  if (typeof document === 'undefined') return null
  const root = document.documentElement
  const scheme = resolveScheme(settings.colorScheme)
  root.dataset.theme = resolveTheme(settings.theme)
  root.dataset.scheme = scheme
  return scheme
}
