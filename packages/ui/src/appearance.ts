import {
  accentWash,
  contrastingInk,
  ensureContrast,
  parseHex,
  toHex,
  type Rgb,
} from '@tracker-engine/core'

export type ColorScheme = 'light' | 'dark'
export type ColorSchemePreference = 'system' | ColorScheme

export interface ThemePreset {
  id: string
  label: string
  swatch: string
}

export interface AppearanceSettings {
  /** Loosely typed: it round-trips through storage, where an older build may have written
   *  a name this one doesn't know. Unknown values fall back to the first preset. */
  theme: string
  colorScheme: ColorSchemePreference
  /** Omit in apps without a custom-accent picker. */
  accentOverride?: string | null
}

export interface AppearanceConfig {
  presets: readonly ThemePreset[]
  /** Page surfaces a custom accent must stay legible against. */
  surfaces?: { light: Rgb; dark: Rgb }
}

const DEFAULT_SURFACES = {
  light: { r: 252, g: 252, b: 251 },
  dark: { r: 26, g: 26, b: 25 },
}

export function resolveScheme(preference: ColorSchemePreference): ColorScheme {
  if (preference !== 'system') return preference
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Two independent axes on <html>: `data-theme` (preset) and `data-scheme` (light/dark).
 * Returns the resolved scheme so the caller can drive platform side-effects such as the
 * native status bar, keeping this free of platform imports.
 */
export function createAppearance(config: AppearanceConfig) {
  const known = new Set(config.presets.map((p) => p.id))
  const fallback = config.presets[0]?.id ?? 'default'
  const surfaces = config.surfaces ?? DEFAULT_SURFACES

  function apply(settings: AppearanceSettings): ColorScheme | null {
    if (typeof document === 'undefined') return null
    const root = document.documentElement
    const scheme = resolveScheme(settings.colorScheme)

    root.dataset.theme = known.has(settings.theme) ? settings.theme : fallback
    root.dataset.scheme = scheme

    const accent = settings.accentOverride ? parseHex(settings.accentOverride) : null
    if (accent) {
      const safe = toHex(ensureContrast(accent, surfaces[scheme]))
      root.style.setProperty('--accent', safe)
      root.style.setProperty('--accent-wash', accentWash(safe, scheme === 'dark' ? 0.18 : 0.1))
      root.style.setProperty('--accent-contrast', contrastingInk(safe))
    } else {
      root.style.removeProperty('--accent')
      root.style.removeProperty('--accent-wash')
      root.style.removeProperty('--accent-contrast')
    }
    return scheme
  }

  return {
    applyAppearance: apply,
    // Runs before any profile exists, so accent-coloured elements on the sign-in screen
    // aren't transparent until sign-in.
    applyDefaultAppearance: () =>
      apply({ theme: fallback, colorScheme: 'system', accentOverride: null }),
  }
}
