import { db, syncStamp } from '@/db/database'
import { getActiveUserId } from '@/db/seed'
import { type MetricEntry } from '@/domain/types'
import { enqueue, newId } from './outbox'
import { updateProfile } from './profile'

export async function listMetricEntries(
  definitionId: string,
  limit = 500,
): Promise<MetricEntry[]> {
  const rows = await db.metricEntries
    .where('definitionId')
    .equals(definitionId)
    .reverse()
    .limit(limit)
    .toArray()
  return rows
    .filter((r) => r.deletedAt === null)
    .sort((a, b) => b.measuredAt - a.measuredAt)
}

export async function addMetricEntry(input: {
  definitionId: string
  value: number
  measuredAt?: number
  notes?: string
}): Promise<string> {
  // Guard against a NaN or non-positive measurement poisoning the charts and volume math.
  if (!Number.isFinite(input.value) || input.value <= 0) {
    throw new Error('Metric value must be a positive number')
  }
  const entry: MetricEntry = {
    id: newId(),
    userId: getActiveUserId(),
    definitionId: input.definitionId,
    measuredAt: input.measuredAt ?? Date.now(),
    value: input.value,
    notes: input.notes ?? '',
    ...syncStamp(),
  }
  await db.metricEntries.add(entry)
  await enqueue('metricEntries', entry.id)

  // Bodyweight feeds volume math for bodyweight exercises, so cache the latest.
  if (input.definitionId === 'bodyweight') {
    await updateProfile({ bodyweightCacheKg: input.value })
  }

  return entry.id
}

// Tombstones finished workouts with no completed set (§6.4.1); these arrive via pull or
// an interrupted session, never from finishWorkout. In-progress workouts are never touched.
