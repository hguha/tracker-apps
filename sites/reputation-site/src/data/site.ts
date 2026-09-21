/**
 * Everything about the site that is a fact rather than a layout decision.
 *
 * Copy, links and section content live here so editing the site never means reading a component.
 * The shape is `SiteConfig` from `@tracker-engine/site-kit`, which is what the shared chrome reads —
 * so anything the nav, hero, footer or CTA says is in this file.
 */

import type { SiteConfig, Stat } from '@tracker-engine/site-kit'

export const site = {
  name: 'REPutation',
  tagline: 'Built rep by rep.',
  wordmark: { lead: 'REP', rest: 'utation' },

  description:
    'Type a set and it saves instantly, even offline. You get real analytics and a coach that actually reads your training.',

  seoDescription:
    'REPutation is a fast, local-first workout tracker for iPhone and the web. Log a set in one tap, watch PRs light up, and get 22 analytics charts plus a conversational AI coach. Free, offline, no account, no ads.',

  origin: 'https://reputation.fitness',
  heroBadge: 'Free · No account · Works offline',
  bloom: '#2a78d6',
  applicationCategory: 'HealthApplication',

  // Same-origin as the marketing site (reputation.fitness/app) — relative so it also works on
  // preview deploys and never hardcodes the domain.
  webAppUrl: '/app',
  privacyUrl: '/app/privacy.html',
  author: { name: 'Hirsh Guha', url: 'https://hirshguha.com' },

  nav: [
    { href: '#logging', label: 'Logging' },
    { href: '#insights', label: 'Insights' },
    { href: '#coach', label: 'Coach' },
    { href: '#leagues', label: 'Leagues' },
    { href: '#faq', label: 'FAQ' },
  ],

  footerNote:
    'A local-first training log. Your record lives on your device first, and goes exactly where you send it.',

  cta: {
    title: 'Start logging in about four seconds.',
    body: 'No sign-up, no trial, no card. Open it, add a lift, type a number — that set is saved before the page would have finished loading anywhere else.',
  },

  /**
   * On the App Store since 1.0.1. No `playStore` key at all rather than a `null` one: there is no
   * Android build, so "coming soon to Google Play" would be a promise nobody is keeping. Android
   * users install the web app, which is what the FAQ says.
   */
  stores: {
    appStore: 'https://apps.apple.com/us/app/reputation-fitness-tracker/id6804464473',
  },
} satisfies SiteConfig

/**
 * The proof-point band under the hero.
 *
 * Each is a claim a skeptic could check, framed to land: the last one is the differentiator most
 * trackers can't make.
 */
export const stats = [
  { value: 193, label: 'exercises built in', suffix: '', hint: 'Every one ready to log, or add your own' },
  { value: 22, label: 'analytics charts', suffix: '', hint: 'Across strength, volume, habit, and body' },
  { value: 100, label: 'yours', suffix: '%', hint: 'Works offline, syncs across devices, export anytime' },
  { value: 0, label: 'ads, ever · $0 forever', suffix: '', hint: 'No subscription, no upsell, nothing tracked' },
] satisfies Stat[]
