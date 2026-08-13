// Movement pattern is derived from the primary muscle's region, not picked by the
// user. Only two consumers need it: cardio switches the log UI (§6.4), and
// push/pull drives session titles (§6.7).

import type { Equipment, MovementPattern, Region } from './types'

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

// A movement is the exercise stripped of its equipment ("Barbell Bench Press" and
// "Dumbbell Bench Press" are both the "Bench Press" movement), so the library and
// picker can offer one movement with an equipment choice rather than a row per
// combination. Records and tracking stay per (movement + equipment) — each combo
// is still its own exercise row — this only groups them for display.
//
// The equipment word is the ONLY thing stripped; grip and angle (Incline,
// Close-Grip, Sumo) name a distinct lift and stay in the movement. Specialty bars
// (EZ-bar, trap bar) map to `barbell` equipment and so can't be told apart within
// a movement, so they aren't stripped and read as their own movements. This is the
// single source of truth for derivation — the seed generator and the launch repair
// both call it, so a server row and a locally created one can never disagree.
// Longest match first — otherwise "Smith Machine" would fall to "Smith" and leave
// a dangling "Machine". Matched as a whole word from anywhere in the name so that
// "Incline Barbell Bench Press" strips to "Incline Bench Press", not "Incline
// Bench Press" vs "Incline Dumbbell Bench Press" ending up as separate movements.
// Longest first so "Smith Machine" wins over "Smith". The display inverse of this
// lives in `lib/labels.ts` as EQUIPMENT_PREFIX — keep the two in step.
const TOKEN_EQUIPMENT: [string, Equipment][] = [
  ['Smith Machine', 'smith'],
  ['Barbell', 'barbell'],
  ['Dumbbell', 'dumbbell'],
  ['Cable', 'cable'],
  ['Kettlebell', 'kettlebell'],
  ['Band', 'band'],
  ['Machine', 'machine'],
  ['Smith', 'smith'],
]

function escapeForRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Splits a written name into its movement and the equipment its wording implies.
// The equipment word used to be stripped and thrown away, which is why a coach
// plan naming "Cable Face Pull" could still end up stamped barbell.
export function splitEquipment(name: string): {
  movement: string
  equipment: Equipment | null
} {
  // Sentinels make word-boundary regexps trivial at either end.
  let padded = ' ' + name.trim() + ' '
  let equipment: Equipment | null = null
  for (const [token, value] of TOKEN_EQUIPMENT) {
    const re = new RegExp(`\\s${escapeForRegExp(token)}\\s`, 'i')
    if (re.test(padded)) {
      padded = padded.replace(re, ' ')
      equipment = value
      break
    }
  }
  const movement = padded.replace(/\s+/g, ' ').trim()
  return { movement: movement || name.trim(), equipment }
}

export function movementFor(name: string): string {
  return splitEquipment(name).movement
}
