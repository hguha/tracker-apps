/**
 * The contract every site's `@site` module satisfies.
 *
 * `@site` is an alias each site sets in its own `astro.config.mjs`, pointing at its content module.
 * This declaration is what lets the kit's components import it without knowing which site they are
 * being rendered into. A site checks itself against the same shape by exporting
 * `satisfies SiteConfig` (etc.) from `@tracker-engine/site-kit`.
 */
declare module '@site' {
  import type { ImageMetadata } from 'astro'
  import type {
    Card,
    Conversation,
    Faq,
    GalleryItem,
    Scheme,
    SiteConfig,
    Spotlight,
    Stat,
  } from '@tracker-engine/site-kit'

  export const site: SiteConfig
  export const stats: readonly Stat[]
  export const spotlights: readonly Spotlight[]
  export const cards: readonly Card[]
  export const gallery: readonly GalleryItem[]
  export const faqs: readonly Faq[]
  export const conversation: Conversation
  export function screen(name: string, scheme: Scheme): ImageMetadata
  export function hasScreen(name: string, scheme: Scheme): boolean
}
