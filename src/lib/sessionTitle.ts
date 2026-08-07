/**
 * Automatic session titles (§6.7).
 *
 * A history list of rows all reading "Workout" carries no information. This
 * derives something scannable — `Jul 29 Evening · Push` — from the date and
 * what was actually trained.
 *
 * Display-only: never written to `workouts.title`, so it stays correct when
 * sets are added later, and a user-typed title always wins.
 */

import { format } from 'date-fns'
import type { MovementPattern, Region } from '@/domain/types'
import { REGION_LABELS } from '@/domain/types'

export type PartOfDay = 'Morning' | 'Afternoon' | 'Evening'

export function partOfDay(timestamp: number): PartOfDay {
  const hour = new Date(timestamp).getHours()
  if (hour < 12) return 'Morning'
  if (hour < 17) return 'Afternoon'
  return 'Evening'
}

/** One entry per working set performed, which is all the inference needs. */
export interface SetSignal {
  region: Region
  pattern: MovementPattern
}

const PUSH_PATTERNS: MovementPattern[] = ['horizontal_push', 'vertical_push']
const PULL_PATTERNS: MovementPattern[] = ['horizontal_pull', 'vertical_pull']
const UPPER_REGIONS: Region[] = ['chest', 'back', 'shoulders', 'biceps', 'triceps']

/** Share of the session a predicate accounts for, 0–1. */
function share(signals: SetSignal[], predicate: (s: SetSignal) => boolean): number {
  if (signals.length === 0) return 0
  return signals.filter(predicate).length / signals.length
}

/**
 * The split label — `Push`, `Legs`, `Upper`, `Full Body`, or a single region's
 * name. Null when there's nothing to infer from.
 *
 * A single region only names itself when it is the *only* region trained.
 * Otherwise the movement story wins: 8 sets of bench plus 2 of triceps reads
 * better as "Push" than as "Chest", because the triceps work is part of the
 * same session intent.
 */
export function inferSplit(signals: SetSignal[]): string | null {
  if (signals.length === 0) return null

  const DOMINANT = 0.7

  const regionCounts = new Map<Region, number>()
  for (const signal of signals) {
    regionCounts.set(signal.region, (regionCounts.get(signal.region) ?? 0) + 1)
  }

  // Exactly one region trained — nothing more specific to say than its name.
  if (regionCounts.size === 1) {
    const [region] = [...regionCounts.keys()]
    return region === 'cardio' ? 'Cardio' : REGION_LABELS[region!]
  }

  const pushShare = share(signals, (s) => PUSH_PATTERNS.includes(s.pattern))
  const pullShare = share(signals, (s) => PULL_PATTERNS.includes(s.pattern))

  // Triceps are push accessories; biceps are pull accessories. Splitting arms
  // lets each land with the movement it actually accompanies.
  const chestShoulderArm = share(signals, (s) =>
    ['chest', 'shoulders', 'triceps'].includes(s.region),
  )
  const backArm = share(signals, (s) => ['back', 'biceps'].includes(s.region))
  const upperShare = share(signals, (s) => UPPER_REGIONS.includes(s.region))
  const legShare = share(signals, (s) => s.region === 'legs')
  const cardioShare = share(signals, (s) => s.region === 'cardio')

  // Push and pull both draw on arms, so the pattern mix breaks the tie.
  if (chestShoulderArm >= DOMINANT && pushShare > pullShare) return 'Push'
  if (backArm >= DOMINANT && pullShare > pushShare) return 'Pull'
  if (legShare >= DOMINANT) return 'Legs'
  if (cardioShare >= DOMINANT) return 'Cardio'
  if (upperShare >= DOMINANT) return 'Upper'

  // A single region dominating without a clearer story still names itself,
  // e.g. mostly back rows plus a little core.
  for (const [region, count] of regionCounts) {
    if (count / signals.length >= DOMINANT) {
      return region === 'cardio' ? 'Cardio' : REGION_LABELS[region]
    }
  }

  return regionCounts.size >= 3 ? 'Full Body' : null
}

/**
 * The displayed title. Falls back through: the user's own title, then a derived
 * one, then a bare date for an empty session.
 */
export function sessionTitle(
  userTitle: string,
  startedAt: number,
  signals: SetSignal[],
): string {
  if (userTitle.trim()) return userTitle.trim()

  const datePart = `${format(startedAt, 'MMM d')} ${partOfDay(startedAt)}`
  const split = inferSplit(signals)
  return split ? `${datePart} · ${split}` : datePart
}
