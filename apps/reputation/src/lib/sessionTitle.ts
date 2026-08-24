// Display-only session titles (§6.7): `Jul 29 Evening · Push`, derived from the
// date and what was trained. Never written to workouts.title; a user title wins.

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

// One entry per working set performed.
export interface SetSignal {
  region: Region
  pattern: MovementPattern
}

const UPPER_REGIONS: Region[] = ['chest', 'back', 'shoulders', 'biceps', 'triceps']

function share(signals: SetSignal[], predicate: (s: SetSignal) => boolean): number {
  if (signals.length === 0) return 0
  return signals.filter(predicate).length / signals.length
}

// A single region names itself only when it's the only one trained; otherwise
// the movement story wins (bench + a little triceps reads as "Push", not "Chest").
export function inferSplit(signals: SetSignal[]): string | null {
  if (signals.length === 0) return null

  const DOMINANT = 0.7

  const regionCounts = new Map<Region, number>()
  for (const signal of signals) {
    regionCounts.set(signal.region, (regionCounts.get(signal.region) ?? 0) + 1)
  }

  if (regionCounts.size === 1) {
    const [region] = [...regionCounts.keys()]
    return region === 'cardio' ? 'Cardio' : REGION_LABELS[region!]
  }

  const pushShare = share(signals, (s) => s.pattern === 'push')
  const pullShare = share(signals, (s) => s.pattern === 'pull')

  // Triceps ride with push, biceps with pull, so each lands with its movement.
  const chestShoulderArm = share(signals, (s) =>
    ['chest', 'shoulders', 'triceps'].includes(s.region),
  )
  const backArm = share(signals, (s) => ['back', 'biceps'].includes(s.region))
  const upperShare = share(signals, (s) => UPPER_REGIONS.includes(s.region))
  const legShare = share(signals, (s) => s.region === 'legs')
  const cardioShare = share(signals, (s) => s.region === 'cardio')

  if (chestShoulderArm >= DOMINANT && pushShare > pullShare) return 'Push'
  if (backArm >= DOMINANT && pullShare > pushShare) return 'Pull'
  if (legShare >= DOMINANT) return 'Legs'
  if (cardioShare >= DOMINANT) return 'Cardio'
  if (upperShare >= DOMINANT) return 'Upper'

  for (const [region, count] of regionCounts) {
    if (count / signals.length >= DOMINANT) {
      return region === 'cardio' ? 'Cardio' : REGION_LABELS[region]
    }
  }

  return regionCounts.size >= 3 ? 'Full Body' : null
}

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
