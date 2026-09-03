// Stamping a session's bodyweight onto the workout row is what makes bodyweight
// volume computable later (metrics reads workout.bodyweightKg, never today's
// profile — a set from March must not be re-scored with September's weight).
//
// So any workout missing one is a permanent zero until it's filled. Recording a
// bodyweight repairs them all, using the measurement nearest that workout in time.

import { db, touch } from '@/db/database'
import { enqueue } from './outbox'

/** The measurement closest in time to `at`. `entries` must be non-empty. */
export function nearestMeasurement(
  entries: { measuredAt: number; value: number }[],
  at: number,
): number {
  let best = entries[0]!
  for (const entry of entries) {
    if (Math.abs(entry.measuredAt - at) <= Math.abs(best.measuredAt - at)) best = entry
  }
  return best.value
}

/**
 * Fills `bodyweightKg` on every workout still missing one — finished sessions
 * included, which is the case the boot migration can't cover (it only runs once,
 * and a user who records their bodyweight *after* logging pull-ups would otherwise
 * keep seeing zero volume for them forever).
 *
 * Idempotent: only null rows are touched. Returns how many were repaired.
 */
export async function backfillWorkoutBodyweights(): Promise<number> {
  const missing = await db.workouts
    .filter((w) => w.bodyweightKg === null && w.deletedAt === null)
    .toArray()
  if (missing.length === 0) return 0

  const measurements = (
    await db.metricEntries.where('definitionId').equals('bodyweight').toArray()
  )
    .filter((e) => e.deletedAt === null)
    .sort((a, b) => a.measuredAt - b.measuredAt)
  if (measurements.length === 0) return 0

  for (const workout of missing) {
    await db.workouts.update(workout.id, {
      bodyweightKg: nearestMeasurement(measurements, workout.startedAt),
      ...touch(workout.clientRev),
    })
    await enqueue('workouts', workout.id)
  }
  return missing.length
}
