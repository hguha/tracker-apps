// Derived training metrics (§8.1). Pure functions; each gets a SQL twin that must
// agree with it on a shared fixture when the Postgres side lands (§8.3).

import type { Exercise, PerformedSet, WorkoutSet } from '@/domain/types'

type VolumeInput = Pick<
  WorkoutSet,
  'weightKg' | 'reps' | 'durationSeconds' | 'distanceM'
> & { isCompleted?: boolean }

// A set counts as work unless explicitly marked incomplete.
export function isWorkingSet(set: VolumeInput): boolean {
  return set.isCompleted !== false
}

// Two-arm dumbbell lifts move a dumbbell per hand, so the entered weight counts
// twice (§6); one-arm dumbbells and everything else are their true total (factor 1).
export function loadUnitsMoved(
  exercise: Pick<Exercise, 'equipment' | 'isUnilateral'>,
): number {
  return exercise.equipment === 'dumbbell' && !exercise.isUnilateral ? 2 : 1
}

// Weight actually moved (doubles two-arm dumbbells, adds a bodyweight fraction).
// Drives volume load only — max-weight and e1RM PRs deliberately use raw entered weight.
export function effectiveWeightKg(
  set: Pick<VolumeInput, 'weightKg'>,
  exercise: Pick<
    Exercise,
    'trackingType' | 'bodyweightFactor' | 'equipment' | 'isUnilateral'
  >,
  bodyweightKg: number | null,
): number | null {
  const entered = set.weightKg ?? 0
  const factor = exercise.bodyweightFactor ?? 1
  const bw = bodyweightKg

  switch (exercise.trackingType) {
    case 'weight_reps':
    case 'weight_time':
      return set.weightKg === null ? null : set.weightKg * loadUnitsMoved(exercise)
    case 'bodyweight_reps':
      return bw === null ? null : bw * factor
    case 'weighted_bodyweight':
      return bw === null ? null : bw * factor + entered
    case 'assisted_bodyweight':
      // The machine takes weight off, so assistance subtracts.
      return bw === null ? null : Math.max(0, bw * factor - entered)
    case 'reps_only':
    case 'time':
    case 'distance_time':
      return null
  }
}

export function volumeLoadKg(
  sets: VolumeInput[],
  exercise: Pick<
    Exercise,
    'trackingType' | 'bodyweightFactor' | 'equipment' | 'isUnilateral'
  >,
  bodyweightKg: number | null,
): number {
  let total = 0
  for (const set of sets) {
    if (!isWorkingSet(set)) continue
    const weight = effectiveWeightKg(set, exercise, bodyweightKg)
    if (weight === null || set.reps === null) continue
    total += weight * set.reps
  }
  return total
}

// Epley e1RM, capped at 12 reps — above that the formula's error exceeds what it
// measures, so null beats a confident wrong number (§8.1).
export function estimatedOneRepMaxKg(
  weightKg: number | null,
  reps: number | null,
): number | null {
  if (weightKg === null || reps === null) return null
  if (reps < 1 || reps > 12) return null
  if (weightKg <= 0) return null
  // A single rep is already a 1RM; plain Epley would inflate it (365×1 → 377).
  if (reps === 1) return weightKg
  return weightKg * (1 + reps / 30)
}

// Inverse Epley: the weight for a target rep count from a known 1RM.
export function weightForRepsKg(oneRepMaxKg: number, reps: number): number | null {
  if (oneRepMaxKg <= 0 || reps < 1 || reps > 12) return null
  return oneRepMaxKg / (1 + reps / 30)
}

export const PROJECTION_REPS = [1, 2, 3, 5, 8, 10, 12] as const

export function bestOneRepMaxKg(
  sets: Pick<PerformedSet, 'weightKg' | 'reps'>[],
): number | null {
  let best: number | null = null
  for (const set of sets) {
    const e1rm = estimatedOneRepMaxKg(set.weightKg, set.reps)
    if (e1rm !== null && (best === null || e1rm > best)) best = e1rm
  }
  return best
}

/** Heaviest completed working set, for the top-set line chart (B-9). */
export function topSetWeightKg(sets: VolumeInput[]): number | null {
  let best: number | null = null
  for (const set of sets) {
    if (!isWorkingSet(set) || set.weightKg === null) continue
    if (best === null || set.weightKg > best) best = set.weightKg
  }
  return best
}

/** Seconds per unit distance. Kept separate from volume load, always (§8.1). */
export function paceSecondsPerM(
  durationSeconds: number | null,
  distanceM: number | null,
): number | null {
  if (!durationSeconds || !distanceM || distanceM <= 0) return null
  return durationSeconds / distanceM
}

/** Crude density proxy. Label it as such wherever it's shown. */
export function tonnagePerMinute(
  volumeKg: number,
  durationSeconds: number | null,
): number | null {
  if (!durationSeconds || durationSeconds <= 0) return null
  return volumeKg / (durationSeconds / 60)
}
