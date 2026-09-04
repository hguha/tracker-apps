export interface Rgb {
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
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function scale(color: Rgb, factor: number): Rgb {
  return {
    r: color.r + (factor > 0 ? (255 - color.r) * factor : color.r * factor),
    g: color.g + (factor > 0 ? (255 - color.g) * factor : color.g * factor),
    b: color.b + (factor > 0 ? (255 - color.b) * factor : color.b * factor),
  }
}

/**
 * Nudges a colour away from a surface, preserving hue, until it clears `minRatio`. A
 * user-chosen accent is one stored hex used on both light and dark surfaces, so it gets
 * corrected rather than rejected.
 */
export function ensureContrast(color: Rgb, surface: Rgb, minRatio = 3): Rgb {
  if (contrastRatio(color, surface) >= minRatio) return color

  const direction = luminance(surface) > 0.5 ? -1 : 1
  let candidate = color
  for (let step = 1; step <= 20; step += 1) {
    candidate = scale(color, direction * step * 0.05)
    if (contrastRatio(candidate, surface) >= minRatio) return candidate
  }
  return candidate
}

export function accentWash(hex: string, alpha = 0.14): string {
  const rgb = parseHex(hex)
  if (!rgb) return 'rgba(0,0,0,0.08)'
  return `rgba(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}, ${alpha})`
}

/** White or near-black, whichever is legible on this accent (buttons use it as bg). */
export function contrastingInk(hex: string): string {
  const rgb = parseHex(hex)
  if (!rgb) return '#ffffff'
  const white = { r: 255, g: 255, b: 255 }
  const black = { r: 11, g: 11, b: 11 }
  return contrastRatio(rgb, white) >= contrastRatio(rgb, black) ? '#ffffff' : '#0b0b0b'
}
