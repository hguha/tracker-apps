/**
 * Everything about the site that is a fact rather than a layout decision.
 *
 * Copy, links and section content live here so editing the site never means
 * reading a component. Anything that appears more than once appears here once.
 */

export const site = {
  name: 'REPutation',
  tagline: 'Built rep by rep.',

  /** The hero paragraph. */
  description:
    'Type a set and it saves instantly, even offline. You get real analytics and a coach that actually reads your training.',

  /** Used for <title>, Open Graph, and the JSON-LD block. */
  seoDescription:
    'REPutation is a fast, local-first workout tracker for iOS, Android and the web. Log a set in one tap, watch PRs light up, and get 22 analytics charts plus a conversational AI coach. Free, offline, no account, no ads.',

  webAppUrl: 'https://hirshguha.com/workout-tracker',
  privacyUrl: 'https://hirshguha.com/workout-tracker/privacy.html',
  author: { name: 'Hirsh Guha', url: 'https://hirshguha.com' },

  /**
   * Store listings. `null` renders the badge as "coming soon" and unclickable —
   * a dead link to a store page that does not exist yet is worse than no link,
   * and this way shipping is a one-line change rather than a template edit.
   */
  stores: {
    appStore: null as string | null,
    playStore: null as string | null,
  },
} as const

/**
 * The proof-point band under the hero.
 *
 * Each is a claim a skeptic could check, framed to land: the last one is the
 * differentiator most trackers can't make.
 */
export const stats = [
  { value: 193, label: 'exercises built in', suffix: '', hint: 'Every one ready to log, or add your own' },
  { value: 22, label: 'analytics charts', suffix: '', hint: 'Across strength, volume, habit, and body' },
  { value: 100, label: 'yours', suffix: '%', hint: 'Works offline, syncs across devices, export anytime' },
  { value: 0, label: 'ads, ever · $0 forever', suffix: '', hint: 'No subscription, no upsell, nothing tracked' },
] as const
