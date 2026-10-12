import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SHARED_THEME_PRESETS } from '@tracker-engine/ui'

const css = readFileSync(
  fileURLToPath(new URL('../../../packages/ui/styles/themes.css', import.meta.url)),
  'utf8',
)

const lightAccent = (id: string): string | undefined =>
  css
    .split(`[data-theme='${id}'][data-scheme='light']`)[1]
    ?.split('}')[0]
    ?.match(/--accent:\s*(#[0-9a-f]{6})/i)?.[1]

describe('shared theme swatches', () => {
  it('show the light accent each theme actually applies', () => {
    for (const preset of SHARED_THEME_PRESETS) {
      expect(preset.swatch, preset.id).toBe(lightAccent(preset.id))
    }
  })
})
