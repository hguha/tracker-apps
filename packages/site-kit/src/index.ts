/**
 * What a marketing site has to tell the kit about itself.
 *
 * The components in here render chrome — a nav, a hero, a fan of phones, a FAQ — and hold no facts.
 * Each site provides those through a module aliased to `@site` in its own `astro.config.mjs`, so a
 * component reads `site.name` rather than taking a dozen props down four levels. Two sites, one
 * layout, and the difference between them is a single content module each.
 */

import type { ImageMetadata } from 'astro'

export interface SiteConfig {
  /** Plain text, for <title>, alt text and JSON-LD. The visible type uses `wordmark`. */
  name: string
  tagline: string
  /** The hero paragraph. */
  description: string
  /** <title>, Open Graph, JSON-LD. */
  seoDescription: string
  /** Production origin, so canonical URLs and the OG image resolve absolutely. */
  origin: string
  /**
   * Same-origin as the site (`/app`), so it also works on preview deploys and never hardcodes
   * the domain.
   */
  webAppUrl: string
  privacyUrl: string
  author: { name: string; url: string }
  /**
   * Store listings, keyed by store. Three states, and the difference between the last two is the
   * point: a URL links the badge, `null` renders it as an unclickable "coming soon", and a key that
   * is **absent** isn't mentioned at all. A dead link to a page that doesn't exist is worse than no
   * link; promising a store nobody is building for is worse than saying nothing.
   */
  stores: Partial<Record<StoreKey, string | null>>
  /**
   * The name, split so its first unit can carry the accent: `REP|utation`, `MACRO|cosm`. Both puns
   * only land if that unit reads as its own word.
   */
  wordmark: { lead: string; rest: string }
  /** The pill above the hero headline — three claims, no verbs. */
  heroBadge: string
  /** The app's own accent, for the page's blooms. A hex, because it lands in gradient strings. */
  bloom: string
  /** The line under the mark in the footer. */
  footerNote: string
  nav: readonly NavLink[]
  /** The closing section, which is the last thing anyone reads. */
  cta: { title: string; body: string }
  /** What the app is, for JSON-LD: both of these are health apps, but say it per site. */
  applicationCategory: string
}

export interface NavLink {
  href: string
  label: string
}

/** The stores a site can badge. Order here is the order they render in. */
export type StoreKey = 'appStore' | 'playStore'

/** A proof point under the hero. Each should be something a skeptic could check. */
export interface Stat {
  value: number
  label: string
  suffix: string
  hint: string
}

export interface Spotlight {
  id: string
  eyebrow: string
  title: string
  body: string
  /** The featured screen — sits at the front of the fan. */
  screen: string
  /** Phones behind the featured one, for a fuller three-up stack. */
  secondScreen?: string
  thirdScreen?: string
  points: readonly { title: string; body: string }[]
  /** A CSS colour, usually one of the app's own category colours. */
  accent: string
}

export interface Card {
  title: string
  body: string
  /** A name from `components/Icon.astro`. An unknown one renders nothing, so keep them in sync. */
  icon: string
  accent: string
}

export interface GalleryItem {
  screen: string
  label: string
}

export interface Faq {
  q: string
  a: string
}

/** The AI section: a scripted exchange beside real screenshots of the thing it describes. */
export interface Conversation {
  eyebrow: string
  title: string
  body: string
  accent: string
  /** Rotated with a crossfade, each showing a different capability. */
  threads: readonly (readonly { from: 'you' | 'coach'; text: string }[])[]
  /** The phones beside the transcript. */
  screens: readonly string[]
  points: readonly { title: string; body: string }[]
}

export type Scheme = 'light' | 'dark'

/**
 * Resolves a screenshot name to the image Astro should optimise.
 *
 * Captures land in a site's `src/assets/screens` as `<name>-<scheme>.png`. The glob has to be
 * written in the site (Vite needs a literal path it can statically analyse), so the site passes the
 * result in and gets the lookup back — which keeps adding a screen to a one-line content change.
 */
export function screenIndex(files: Record<string, { default: ImageMetadata }>): {
  screen: (name: string, scheme: Scheme) => ImageMetadata
  hasScreen: (name: string, scheme: Scheme) => boolean
} {
  const byName = new Map<string, ImageMetadata>(
    Object.entries(files).map(([path, module]) => [
      path.replace(/^.*\/(.+)\.png$/, '$1'),
      module.default,
    ]),
  )

  return {
    screen(name, scheme) {
      const image = byName.get(`${name}-${scheme}`)
      // Loud on purpose: a typo would otherwise ship as a silently missing phone.
      if (!image) throw new Error(`No screenshot "${name}-${scheme}" in src/assets/screens`)
      return image
    },
    hasScreen: (name, scheme) => byName.has(`${name}-${scheme}`),
  }
}
