/**
 * Deriving an exercise's movement pattern from its primary muscle group.
 *
 * Movement pattern is no longer something the user picks (see MOVEMENT_PATTERNS
 * in `types.ts`): asking whether a lift is a "squat" or a "hinge" turned creating
 * an exercise into a taxonomy quiz, and nothing in the app answered a question
 * with the result. But two features do need a coarse version of it, and both can
 * infer it from the muscle that's already required:
 *
 *   - **Cardio** switches the logging UI to time and distance (§6.4). Every
 *     cardio exercise has a primary muscle in the `cardio` region, so that
 *     region *is* the signal — a 1:1 correspondence across all 21 seeded cardio
 *     exercises before this was introduced.
 *   - **Push vs pull** is what lets a session title say "Push" rather than
 *     "Chest" (§6.7): chest/shoulder/triceps work is pushing, back/biceps work
 *     is pulling.
 *
 * Legs, core, and anything else are `other`, which the title logic already
 * handles by naming the region.
 */

import type { MovementPattern, Region } from './types'

/** The pattern implied by a primary muscle's region. */
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
