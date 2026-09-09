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

/**
 * Points `<meta name="theme-color">` at the page surface the app is actually showing.
 *
 * Static metas can't do this: the tags are declared per `prefers-color-scheme`, so an installed
 * iOS app whose user picked Light while the phone is in Dark paints the strip above the web view
 * from the *dark* tag — a black bar over a light app. Reading the computed variable also keeps it
 * right for a theme whose page colour isn't the default one, and for a custom accent.
 */
export function syncThemeColor(): void {
  if (typeof document === 'undefined') return
  const surface = getComputedStyle(document.documentElement)
    .getPropertyValue('--surface-page')
    .trim()
  if (!surface) return

  // The media-scoped tags would still win, so they go: one tag, driven by the app's own state.
  for (const tag of document.querySelectorAll('meta[name="theme-color"][media]')) tag.remove()

  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
  }
  meta.content = surface
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

    syncThemeColor()
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
