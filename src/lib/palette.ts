// Region → color (§10.2). Fixed per region and read from CSS so light/dark live
// in tokens.css, and filtering a region out never repaints the survivors.

import type { Region } from '@/domain/types'

const CSS_VARIABLE: Record<Region, string> = {
  chest: '--region-chest',
  back: '--region-back',
  legs: '--region-legs',
  shoulders: '--region-shoulders',
  biceps: '--region-biceps',
  triceps: '--region-triceps',
  core: '--region-core',
  cardio: '--region-cardio',
}

export function regionVar(region: Region): string {
  return `var(${CSS_VARIABLE[region]})`
}

// Resolved hex for ECharts, which can't take a var(). Call at render time so a
// theme switch picks up the new value.
export function resolveRegionColor(region: Region): string {
  if (typeof window === 'undefined') return '#2a78d6'
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(CSS_VARIABLE[region])
    .trim()
  return value || '#2a78d6'
}

export function resolveToken(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}
