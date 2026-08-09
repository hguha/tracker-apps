import { describe, expect, it } from 'vitest'
import {
  THEME_PRESETS,
  accentWash,
  contrastRatio,
  contrastingInk,
  ensureContrast,
  parseHex,
  resolveScheme,
  toHex,
} from './theme'

const LIGHT_SURFACE = { r: 252, g: 252, b: 251 }
const DARK_SURFACE = { r: 26, g: 26, b: 25 }

describe('parseHex', () => {
  it('parses six-digit hex', () => {
    expect(parseHex('#2a78d6')).toEqual({ r: 42, g: 120, b: 214 })
  })

  it('expands three-digit shorthand', () => {
    expect(parseHex('#abc')).toEqual({ r: 170, g: 187, b: 204 })
  })

  it('tolerates a missing hash', () => {
    expect(parseHex('2a78d6')).toEqual({ r: 42, g: 120, b: 214 })
  })

  it('rejects nonsense rather than guessing', () => {
    expect(parseHex('not-a-color')).toBeNull()
    expect(parseHex('#12345')).toBeNull()
    expect(parseHex('')).toBeNull()
  })
})

describe('toHex', () => {
  it('round-trips', () => {
    expect(toHex({ r: 42, g: 120, b: 214 })).toBe('#2a78d6')
  })

  it('clamps out-of-range channels instead of overflowing', () => {
    expect(toHex({ r: 300, g: -20, b: 128 })).toBe('#ff0080')
  })
})

describe('contrastRatio', () => {
  it('is 21:1 for black on white', () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(
      21,
      1,
    )
  })

  it('is 1:1 for a color against itself', () => {
    expect(contrastRatio(LIGHT_SURFACE, LIGHT_SURFACE)).toBeCloseTo(1, 5)
  })

  it('is symmetric', () => {
    const a = { r: 42, g: 120, b: 214 }
    expect(contrastRatio(a, LIGHT_SURFACE)).toBeCloseTo(
      contrastRatio(LIGHT_SURFACE, a),
      5,
    )
  })
})

describe('ensureContrast', () => {
  it('leaves a color that already passes untouched', () => {
    const navy = { r: 13, g: 54, b: 107 }
    expect(ensureContrast(navy, LIGHT_SURFACE)).toEqual(navy)
  })

  it('darkens a too-light color on a light surface', () => {
    const paleYellow = { r: 250, g: 240, b: 120 }
    const fixed = ensureContrast(paleYellow, LIGHT_SURFACE)
    expect(contrastRatio(fixed, LIGHT_SURFACE)).toBeGreaterThanOrEqual(3)
  })

  it('lightens a too-dark color on a dark surface', () => {
    const nearBlack = { r: 24, g: 24, b: 30 }
    const fixed = ensureContrast(nearBlack, DARK_SURFACE)
    expect(contrastRatio(fixed, DARK_SURFACE)).toBeGreaterThanOrEqual(3)
  })

  it('reaches the floor for every hue on both surfaces', () => {
    // The picker accepts any color, so the nudge has to work everywhere rather
    // than only for the swatches we ship.
    for (let hue = 0; hue < 360; hue += 15) {
      const rgb = hslToRgb(hue, 0.7, 0.5)
      for (const surface of [LIGHT_SURFACE, DARK_SURFACE]) {
        const fixed = ensureContrast(rgb, surface)
        expect(contrastRatio(fixed, surface)).toBeGreaterThanOrEqual(2.9)
      }
    }
  })
})

describe('contrastingInk', () => {
  it('puts white text on a dark accent', () => {
    expect(contrastingInk('#0d366b')).toBe('#ffffff')
  })

  it('puts dark text on a pale accent', () => {
    expect(contrastingInk('#f0f0f0')).toBe('#0b0b0b')
  })

  it('always picks the more legible of the two', () => {
    for (let hue = 0; hue < 360; hue += 30) {
      for (const lightness of [0.2, 0.5, 0.85]) {
        const hex = toHex(hslToRgb(hue, 0.7, lightness))
        const ink = contrastingInk(hex)
        const other = ink === '#ffffff' ? '#0b0b0b' : '#ffffff'
        expect(contrastRatio(parseHex(hex)!, parseHex(ink)!)).toBeGreaterThanOrEqual(
          contrastRatio(parseHex(hex)!, parseHex(other)!),
        )
      }
    }
  })
})

describe('accentWash', () => {
  it('produces an rgba string at the requested alpha', () => {
    expect(accentWash('#2a78d6', 0.1)).toBe('rgba(42, 120, 214, 0.1)')
  })

  it('degrades to a neutral wash for an invalid color', () => {
    expect(accentWash('nope')).toBe('rgba(0,0,0,0.08)')
  })
})

describe('resolveScheme', () => {
  it('passes explicit choices through', () => {
    expect(resolveScheme('light')).toBe('light')
    expect(resolveScheme('dark')).toBe('dark')
  })
})

describe('theme presets', () => {
  it('every preset swatch is a valid color', () => {
    for (const preset of THEME_PRESETS) {
      expect(parseHex(preset.swatch), preset.id).not.toBeNull()
    }
  })

  it('every preset swatch is legible on at least one surface', () => {
    // The swatch is rendered as a filled dot, so it needs to be visible in the
    // scheme the user is currently in.
    for (const preset of THEME_PRESETS) {
      const rgb = parseHex(preset.swatch)!
      const best = Math.max(
        contrastRatio(rgb, LIGHT_SURFACE),
        contrastRatio(rgb, DARK_SURFACE),
      )
      expect(best, preset.id).toBeGreaterThanOrEqual(3)
    }
  })

  it('has unique ids', () => {
    const ids = THEME_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

/** Minimal HSL→RGB so the property tests can sweep the hue circle. */
function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = h / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const [r1, g1, b1] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x]
  const m = l - c / 2
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  }
}
