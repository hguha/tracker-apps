/**
 * Derived training metrics (§8.1). Pure functions — no I/O, no dates beyond
 * what's passed in — because these numbers appear both on the active workout
 * screen and in every chart, and the two must never disagree.
 *
 * When the Postgres side lands, each function here gets a SQL twin that must
 * agree with it on a shared fixture (§8.3).
 */

import type { Exercise, PerformedSet, Region, SetType, WorkoutSet } from '@/domain/types'

/** Set shapes that carry enough to compute volume. Accepts stored or cached rows. */
type VolumeInput = Pick<
  WorkoutSet,
  'setType' | 'weightKg' | 'reps' | 'durationSeconds' | 'distanceM'
> & { isCompleted?: boolean }

const EXCLUDED_FROM_VOLUME: SetType[] = ['warmup']

export function countsTowardVolume(set: VolumeInput): boolean {
  if (set.isCompleted === false) return false
  return !EXCLUDED_FROM_VOLUME.includes(set.setType)
}

/**
 * The weight actually moved, which is not the number on the bar for
 * bodyweight movements. A weighted pull-up at +20 kg for a 80 kg lifter is
 * 100 kg per rep, and treating it as 20 kg makes back volume look trivial.
 */
export function effectiveWeightKg(
  set: Pick<VolumeInput, 'weightKg'>,
  exercise: Pick<Exercise, 'trackingType' | 'bodyweightFactor'>,
  bodyweightKg: number | null,
): number | null {
  const entered = set.weightKg ?? 0
  const factor = exercise.bodyweightFactor ?? 1
  const bw = bodyweightKg

  switch (exercise.trackingType) {
    case 'weight_reps':
    case 'weight_time':
      return set.weightKg
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
      // No external load to speak of — these contribute no volume load.
      return null
  }
}

/** Σ (effective weight × reps) over completed, non-warmup sets. */
export function volumeLoadKg(
  sets: VolumeInput[],
  exercise: Pick<Exercise, 'trackingType' | 'bodyweightFactor'>,
  bodyweightKg: number | null,
): number {
  let total = 0
  for (const set of sets) {
    if (!countsTowardVolume(set)) continue
    const weight = effectiveWeightKg(set, exercise, bodyweightKg)
    if (weight === null || set.reps === null) continue
    total += weight * set.reps
  }
  return total
}

/**
 * A set of real work — logged and not a warmup. This is the number shown to the
 * user and counted per body part.
 *
 * Replaces an earlier `isHardSet` that additionally required `reps >= 5` and an
 * RPE of 7+. Both rules were wrong to surface: a set of three heavy singles is
 * not easy, and "hard set" is jargon a reader cannot define on sight, so it
 * could not honestly label a stat tile.
 */
export function isWorkingSet(set: VolumeInput): boolean {
  return countsTowardVolume(set)
}

/**
 * Epley estimated one-rep max, deliberately capped at 12 reps.
 *
 * Above 12 the formula's error exceeds what it's measuring — a 20-rep set
 * would project an e1RM the lifter cannot come close to. Returning null is
 * more useful than a confident wrong number.
 */
export function estimatedOneRepMaxKg(
  weightKg: number | null,
  reps: number | null,
): number | null {
  if (weightKg === null || reps === null) return null
  if (reps < 1 || reps > 12) return null
  if (weightKg <= 0) return null
  return weightKg * (1 + reps / 30)
}

/** Best e1RM across a group of sets, ignoring sets outside the valid window. */
export function bestOneRepMaxKg(
  sets: Pick<PerformedSet, 'weightKg' | 'reps' | 'setType'>[],
): number | null {
  let best: number | null = null
  for (const set of sets) {
    if (set.setType === 'warmup') continue
    const e1rm = estimatedOneRepMaxKg(set.weightKg, set.reps)
    if (e1rm !== null && (best === null || e1rm > best)) best = e1rm
  }
  return best
}

/** The heaviest completed working set, for the top-set line chart (B-9). */
export function topSetWeightKg(sets: VolumeInput[]): number | null {
  let best: number | null = null
  for (const set of sets) {
    if (!countsTowardVolume(set) || set.weightKg === null) continue
    if (best === null || set.weightKg > best) best = set.weightKg
  }
  return best
}

/**
 * Spread one exercise's volume across the muscles that did the work.
 *
 * Primary muscle takes full credit; each secondary takes its contribution
 * weight. This is what stops a reverse dumbbell fly from being counted as
 * chest work just because it looks like a chest movement.
 */
export function attributeVolumeToMuscles(
  volumeKg: number,
  exercise: Pick<Exercise, 'primaryMuscleId' | 'secondaryMuscles'>,
): Map<string, number> {
  const byMuscle = new Map<string, number>()
  byMuscle.set(exercise.primaryMuscleId, volumeKg)
  for (const secondary of exercise.secondaryMuscles) {
    const existing = byMuscle.get(secondary.muscleId) ?? 0
    byMuscle.set(secondary.muscleId, existing + volumeKg * secondary.contribution)
  }
  return byMuscle
}

/** Roll muscle-level numbers up to the 7 regions the palette is built for. */
export function rollUpToRegions(
  byMuscle: Map<string, number>,
  regionOf: (muscleId: string) => Region | undefined,
): Map<Region, number> {
  const byRegion = new Map<Region, number>()
  for (const [muscleId, value] of byMuscle) {
    const region = regionOf(muscleId)
    if (!region) continue
    byRegion.set(region, (byRegion.get(region) ?? 0) + value)
  }
  return byRegion
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
