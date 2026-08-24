/**
 * Resolves a screenshot name to the image Astro should optimise.
 *
 * Captures land in `src/assets/screens` as `<name>-<scheme>.png`. Globbing them
 * eagerly means adding a screen to the gallery is a one-line content change with
 * no import to remember.
 */

import type { ImageMetadata } from 'astro'

const files = import.meta.glob<{ default: ImageMetadata }>(
  '../assets/screens/*.png',
  { eager: true },
)

const byName = new Map<string, ImageMetadata>(
  Object.entries(files).map(([path, module]) => [
    path.replace(/^.*\/(.+)\.png$/, '$1'),
    module.default,
  ]),
)

export type Scheme = 'light' | 'dark'

export function screen(name: string, scheme: Scheme): ImageMetadata {
  const image = byName.get(`${name}-${scheme}`)
  // Loud on purpose: a typo would otherwise ship as a silently missing phone.
  if (!image) throw new Error(`No screenshot "${name}-${scheme}" in src/assets/screens`)
  return image
}

export const hasScreen = (name: string, scheme: Scheme): boolean =>
  byName.has(`${name}-${scheme}`)
