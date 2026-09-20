/**
 * The screenshots this site ships, by name.
 *
 * The glob has to live in the site — Vite only accepts a literal path it can analyse — so the site
 * globs and the kit does the lookup. Adding a screen to the gallery stays a one-line content change
 * with no import to remember, and a name with no file throws at build time rather than shipping an
 * empty phone.
 */

import { screenIndex } from '@tracker-engine/site-kit'

export const { screen, hasScreen } = screenIndex(
  import.meta.glob('../assets/screens/*.png', { eager: true }),
)
