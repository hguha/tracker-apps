/**
 * Everything about the site that is a fact rather than a layout decision.
 *
 * Copy, links and section content live here so editing the site never means reading a component.
 * The shape is `SiteConfig` from `@tracker-engine/site-kit`, which is what the shared chrome reads —
 * so anything the nav, hero, footer or CTA says is in this file.
 */

import type { SiteConfig, Stat } from '@tracker-engine/site-kit'

export const site = {
  name: 'MACROcosm',
  tagline: 'Measured, not guessed.',
  wordmark: { lead: 'MACRO', rest: 'cosm' },

  description:
    'Tick four foods and they log at the amounts you actually eat. Your calorie target comes from what your weight and your intake have done — not from a formula about someone your size.',

  seoDescription:
    'MACROcosm is a fast, local-first calorie and macro tracker for iPhone and the web. 1,500 foods offline, USDA search, recipes you can cook from, and a calorie target measured from your own weight trend. Free, offline, no account, no ads.',

  origin: 'https://macrocosm.fitness',
  heroBadge: 'Free · No account · Works offline',
  bloom: '#d2601a',
  applicationCategory: 'HealthApplication',

  // Same-origin as the marketing site (macrocosm.fitness/app) — relative so it also works on
  // preview deploys and never hardcodes the domain.
  webAppUrl: '/app',
  privacyUrl: '/app/privacy.html',
  author: { name: 'Hirsh Guha', url: 'https://hirshguha.com' },

  nav: [
    { href: '#logging', label: 'Logging' },
    { href: '#targets', label: 'Targets' },
    { href: '#recipes', label: 'Recipes' },
    { href: '#coach', label: 'Coach' },
    { href: '#faq', label: 'FAQ' },
  ],

  footerNote:
    'A local-first food diary. Every number comes from a real measurement, and your day lives on your device first.',

  cta: {
    title: 'Log breakfast before the kettle boils.',
    body: 'No sign-up, no trial, no card. Search a food, tick it, and it is on the day at the amount you had last time — offline, and in about the time it takes to read this.',
  },

  /**
   * `null` is a listing that is coming — the iPhone build is real, the App Store record isn't yet.
   * There is no `playStore` key at all, because there is no Android build to promise: Android
   * installs the web app, which is what the FAQ says.
   */
  stores: {
    appStore: null as string | null,
  },
} satisfies SiteConfig

/**
 * The proof-point band under the hero.
 *
 * Every one of these is countable in the repo: the seeded food rows, the charts on the Insights
 * tabs, the micronutrients a day is scored against. Nothing here is a round number chosen because
 * it sounded good.
 */
export const stats = [
  {
    value: 1509,
    label: 'foods, offline',
    suffix: '',
    hint: 'Portions and micronutrients included — plus all of USDA when you have signal',
  },
  {
    value: 17,
    label: 'charts',
    suffix: '',
    hint: 'Intake, body, habits and nutrients, each with the number behind it',
  },
  {
    value: 100,
    label: 'yours',
    suffix: '%',
    hint: 'Works offline, syncs across devices, exports whenever you like',
  },
  {
    value: 0,
    label: 'ads, ever · $0 forever',
    suffix: '',
    hint: 'No subscription, no premium macros, nothing tracked',
  },
] satisfies Stat[]
