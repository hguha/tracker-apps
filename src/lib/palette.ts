/**
 * Region → color, resolved from CSS custom properties (§10.2).
 *
 * The assignment is fixed. Color follows the region, never its rank, so
 * filtering a region out of a chart must never repaint the survivors — a reader
 * who learned "back is orange" has to stay right.
 *
 * Reading from CSS rather than hardcoding hex means light and dark stay in one
 * place, in `tokens.css`.
 */

import type { Region } from '@/domain/types'

const CSS_VARIABLE: Record<Region, string> = {
  chest: '--region-chest',
  back: '--region-back',
  legs: '--region-legs',
  shoulders: '--region-shoulders',
  arms: '--region-arms',
  core: '--region-core',
  cardio: '--region-cardio',
}

/** For inline styles and Tailwind arbitrary values. */
export function regionVar(region: Region): string {
  return `var(${CSS_VARIABLE[region]})`
}

/**
 * Resolved hex, for ECharts — which needs a real color, not a var() reference.
 * Call at render time so a theme switch picks up the new value.
 */
export function resolveRegionColor(region: Region): string {
  if (typeof window === 'undefined') return '#2a78d6'
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(CSS_VARIABLE[region])
    .trim()
  return value || '#2a78d6'
}

export function resolveToken(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  return value || fallback
}

/**
 * Three light-mode region colors sit below 3:1 contrast on the light surface
 * (legs, shoulders, arms — measured, not estimated). Charts using them owe the
 * reader a visible direct label or the table view; color alone is not enough.
 * Flagged here so the obligation is visible at the call site.
 */
export const LOW_CONTRAST_ON_LIGHT: Region[] = ['legs', 'shoulders', 'arms']

/**
 * Scatter, bubble, and small-multiple forms compare every pair of colors at
 * once, and only the first three slots clear that bar. Past three, facet or
 * fold into "Other" — never generate another hue.
 */
export const ALL_PAIRS_SERIES_CAP = 3
