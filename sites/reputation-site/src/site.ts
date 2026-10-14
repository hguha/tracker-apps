/**
 * What `@site` resolves to — this site's half of the contract in `@tracker-engine/site-kit`.
 *
 * The shared components import `@site` rather than taking a dozen props down four levels, and the
 * alias is set in `astro.config.mjs`. The content itself lives in `data/`, where it can be edited
 * without reading any of this. The screenshot glob has to live in the site — Vite only accepts a
 * literal path it can analyse — so the site globs and the kit does the lookup.
 */

import { screenIndex } from '@tracker-engine/site-kit'

export { site, stats } from '@/data/site'
export { cards, conversation, faqs, gallery, spotlights } from '@/data/features'

export const { screen } = screenIndex(import.meta.glob('./assets/screens/*.png', { eager: true }))
