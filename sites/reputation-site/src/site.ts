/**
 * What `@site` resolves to — this site's half of the contract in `@tracker-engine/site-kit`.
 *
 * The shared components import `@site` rather than taking a dozen props down four levels, and the
 * alias is set in `astro.config.mjs`. Everything here is a re-export: the content itself lives in
 * `data/`, where it can be edited without reading any of this.
 */

export { site, stats } from '@/data/site'
export { cards, conversation, faqs, gallery, spotlights } from '@/data/features'
export { hasScreen, screen } from '@/lib/screens'
