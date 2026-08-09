/**
 * Theme application and accent validation (§10.8).
 *
 * A custom accent has to stay readable against both the light and dark surface
 * of the chosen preset, since a single stored hex is used in both. Rather than
 * rejecting a color the user liked, we walk its lightness until it clears the
 * contrast floor — nudging to the nearest passing step, which is the same
 * discipline the chart palette follows.
 */

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
export type ColorSchemePreference = 'system' | 'light' | 'dark'

/** Text/UI contrast floor for an accent that carries white or dark text on it. */
const MIN_CONTRAST = 3

// ------------------------------------------------------------ color math

interface Rgb {
  r: number
  g: number
  b: number
}

export function parseHex(hex: string): Rgb | null {
  const cleaned = hex.trim().replace(/^#/, '')
  const expanded =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map((c) => c + c)
          .join('')
      : cleaned
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return null
  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16),
  }
}

export function toHex({ r, g, b }: Rgb): string {
  const part = (v: number) =>
    Math.round(Math.max(0, Math.min(255, v)))
      .toString(16)
      .padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

/** WCAG relative luminance. */
function luminance({ r, g, b }: Rgb): number {
  const channel = (value: number) => {
    const v = value / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a)
  const lb = luminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

function scale(color: Rgb, factor: number): Rgb {
  return {
    r: color.r + (factor > 0 ? (255 - color.r) * factor : color.r * factor),
    g: color.g + (factor > 0 ? (255 - color.g) * factor : color.g * factor),
    b: color.b + (factor > 0 ? (255 - color.b) * factor : color.b * factor),
  }
}

/**
 * Nudges a color toward or away from a surface until it clears the contrast
 * floor, preserving hue. Returns the original when it already passes.
 */
export function ensureContrast(color: Rgb, surface: Rgb, minRatio = MIN_CONTRAST): Rgb {
  if (contrastRatio(color, surface) >= minRatio) return color

  // Move away from the surface: darker on light surfaces, lighter on dark ones.
  const direction = luminance(surface) > 0.5 ? -1 : 1
  let candidate = color
  for (let step = 1; step <= 20; step += 1) {
    candidate = scale(color, direction * step * 0.05)
    if (contrastRatio(candidate, surface) >= minRatio) return candidate
  }
  return candidate
}

/** A wash for active states — the accent at low alpha. */
export function accentWash(hex: string, alpha = 0.14): string {
  const rgb = parseHex(hex)
  if (!rgb) return 'rgba(0,0,0,0.08)'
  return `rgba(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}, ${alpha})`
}

/**
 * Whether white or near-black text is legible on this accent. Buttons use the
 * accent as a background, so this decides the label color.
 */
export function contrastingInk(hex: string): string {
  const rgb = parseHex(hex)
  if (!rgb) return '#ffffff'
  const white = { r: 255, g: 255, b: 255 }
  const black = { r: 11, g: 11, b: 11 }
  return contrastRatio(rgb, white) >= contrastRatio(rgb, black) ? '#ffffff' : '#0b0b0b'
}

// ---------------------------------------------------------------- apply

export interface AppearanceSettings {
  /**
   * A preset id. Typed loosely because it round-trips through storage, where an
   * older or newer build could have written a name this version doesn't know;
   * `applyAppearance` falls back rather than leaving the app unthemed.
   */
  theme: string
  colorScheme: ColorSchemePreference
  accentOverride: string | null
}

const KNOWN_THEMES = new Set<string>(THEME_PRESETS.map((preset) => preset.id))

function resolveTheme(theme: string): ThemeId {
  return KNOWN_THEMES.has(theme) ? (theme as ThemeId) : 'default'
}

export function resolveScheme(preference: ColorSchemePreference): 'light' | 'dark' {
  if (preference !== 'system') return preference
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Writes the theme to <html>. Called on load and whenever appearance changes.
 * Everything else in the app reads CSS variables, so this is the only place
 * that knows a theme switch happened.
 */
/**
 * Applies the default theme before any profile has loaded.
 *
 * Without this, `--accent` and `--surface-*` are unset until sign-in completes,
 * so the auth screen renders its accent-colored button and logo as transparent
 * shapes. Called once at module load.
 */
export function applyDefaultAppearance(): void {
  applyAppearance({ theme: 'default', colorScheme: 'system', accentOverride: null })
}

export function applyAppearance(settings: AppearanceSettings): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const scheme = resolveScheme(settings.colorScheme)

  root.dataset.theme = resolveTheme(settings.theme)
  root.dataset.scheme = scheme

  if (settings.accentOverride) {
    const rgb = parseHex(settings.accentOverride)
    if (rgb) {
      // The same stored accent is used in both schemes, so hold it to the
      // contrast floor of whichever surface is currently showing.
      const surface =
        scheme === 'dark' ? { r: 26, g: 26, b: 25 } : { r: 252, g: 252, b: 251 }
      const safe = toHex(ensureContrast(rgb, surface))
      root.style.setProperty('--accent', safe)
      root.style.setProperty(
        '--accent-wash',
        accentWash(safe, scheme === 'dark' ? 0.18 : 0.1),
      )
      root.style.setProperty('--accent-contrast', contrastingInk(safe))
      return
    }
  }

  root.style.removeProperty('--accent')
  root.style.removeProperty('--accent-wash')
  root.style.removeProperty('--accent-contrast')
}
