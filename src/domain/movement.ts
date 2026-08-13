// Movement pattern is derived from the primary muscle's region, not picked by the
// user. Only two consumers need it: cardio switches the log UI (§6.4), and
// push/pull drives session titles (§6.7).

import type { MovementPattern, Region } from './types'

export function patternForRegion(region: Region): MovementPattern {
  switch (region) {
    case 'cardio':
      return 'cardio'
    case 'chest':
    case 'shoulders':
    case 'triceps':
      return 'push'
    case 'back':
    case 'biceps':
      return 'pull'
    case 'legs':
    case 'core':
      return 'other'
  }
}

/**
 * Whether an exercise is cardio, and so logs as time/distance rather than sets.
 *
 * The one predicate for this. It was spelled `movementPattern === 'cardio'` at
 * six call sites, which is fine until the derivation changes and one is missed.
 */
export function isCardioPattern(pattern: MovementPattern): boolean {
  return pattern === 'cardio'
}
