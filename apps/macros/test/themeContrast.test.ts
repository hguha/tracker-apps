import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Every theme, in both schemes, has to be readable.
 *
 * This exists because the app shipped with one grey — `#898781` — reused as `--text-muted` across
 * every preset, measuring **2.83:1 to 3.7:1** against the surfaces it sat on. That colour carries most
 * of the app's secondary text at 11–12.5px: settings hints, tab-bar labels, "/ 144 g", "Nothing logged
 * yet". The result was text that read as faded rather than quiet, and in the greyer presets as barely
 * there at all — which is exactly what "the mono theme makes some text disappear" described.
 *
 * A browser test found it and a browser test would find it again, but only for the screens it happened
 * to visit. The tokens are the actual contract, so they are what gets checked: parse the CSS and assert
 * every ink-on-surface pair in all fourteen combinations clears WCAG AA. Picking a prettier grey by eye
 * now fails here rather than in three months on somebody's phone.
 */

const files = [
  '../src/styles/themes.css',
  '../../../packages/ui/styles/themes.css',
].map((path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8'))

interface Theme {
  name: string
  scheme: string
  vars: Record<string, string>
}

function parseThemes(css: string): Theme[] {
  const out: Theme[] = []
  const blocks = css.matchAll(
    /\[data-theme='([\w-]+)'\]\[data-scheme='(\w+)'\]\s*\{([^}]*)\}/g,
  )
  for (const block of blocks) {
    const vars: Record<string, string> = {}
    for (const line of (block[3] ?? '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      vars[line[1]!] = line[2]!.trim()
    }
    out.push({ name: block[1]!, scheme: block[2]!, vars })
  }
  return out
}

const THEMES = files.flatMap(parseThemes)

function rgb(value: string): [number, number, number] {
  const hex = value.match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const n = parseInt(hex[1]!, 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const fn = value.match(/^rgba?\(([^)]+)\)$/)
  if (fn) {
    const parts = fn[1]!.split(',').map((part) => Number(part))
    return [parts[0]!, parts[1]!, parts[2]!]
  }
  throw new Error(`Unparseable colour: ${value}`)
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(rgb(a)), luminance(rgb(b))]
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

const SURFACES = ['--surface-page', '--surface-1', '--surface-sunken'] as const

describe('theme tokens', () => {
  it('defines all fourteen theme and scheme combinations', () => {
    // A preset whose block is missing entirely inherits nothing and renders as unstyled white, which
    // is a whole class of "the theme picker does nothing" bug.
    expect(THEMES).toHaveLength(14)
    const names = new Set(THEMES.map((theme) => theme.name))
    expect([...names].sort()).toEqual([
      'crimson',
      'default',
      'forest',
      'mono',
      'ocean',
      'slate',
      'sunset',
    ])
    for (const theme of THEMES) {
      for (const key of [...SURFACES, '--text-primary', '--text-secondary', '--text-muted', '--accent', '--accent-contrast']) {
        expect(theme.vars[key], `${theme.name}/${theme.scheme} is missing ${key}`).toBeDefined()
      }
    }
  })

  it.each(THEMES.map((theme) => [`${theme.name}/${theme.scheme}`, theme] as const))(
    '%s keeps every ink legible on every surface',
    (_label, theme) => {
      for (const surface of SURFACES) {
        const bg = theme.vars[surface]!
        // 4.5:1 is AA for body text, and `--text-muted` is body text — it is not a decorative grey.
        expect(contrast(theme.vars['--text-muted']!, bg)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(theme.vars['--text-secondary']!, bg)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(theme.vars['--text-primary']!, bg)).toBeGreaterThanOrEqual(7)
        // The accent carries links and button labels, not just fills.
        expect(contrast(theme.vars['--accent']!, bg)).toBeGreaterThanOrEqual(4.5)
      }
      // And whatever sits *on* the accent has to survive it — a white label on a pale accent is the
      // other half of the same bug.
      expect(
        contrast(theme.vars['--accent-contrast']!, theme.vars['--accent']!),
      ).toBeGreaterThanOrEqual(4.5)
    },
  )

  it.each(THEMES.map((theme) => [`${theme.name}/${theme.scheme}`, theme] as const))(
    '%s has a page you can tell apart from a card',
    (_label, theme) => {
      // Every preset used to be 97% white in light mode, so picking one changed the accent and
      // nothing else — "it goes all white and doesn't actually work". A card has to read as raised.
      const ratio = contrast(theme.vars['--surface-page']!, theme.vars['--surface-1']!)
      expect(ratio).toBeGreaterThan(1.04)
    },
  )
})
