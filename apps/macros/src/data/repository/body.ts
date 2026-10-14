import { dayKey } from '@tracker-engine/core'
import { syncStamp } from '@tracker-engine/local-first'
import { db } from '@/db'
import { enqueue, patch } from '@/data/outbox'
import { type BodyWeightRow } from '@/domain/types'
import { activeUserId, alive, byDay } from './internal'

export function weights(): Promise<BodyWeightRow[]> {
  return db.bodyWeights.filter(alive).toArray()
}

/**
 * One weigh-in per day: re-weighing replaces rather than adding, so the trend can't be skewed
 * by stepping on the scale twice.
 *
 * The id is derived from (user, day) rather than random, because that pair *is* the natural key
 * — the table has a unique index on it. With a random id, a device that hadn't yet pulled an
 * existing weigh-in would insert a second row for the same day and the push would 409 against
 * that index, dead-lettering silently. Upserting on a deterministic id makes the write
 * idempotent from any device.
 */
export const weightIdFor = (userId: string, day: string): string => `bw:${userId}:${day}`

export async function recordWeight(
  kg: number,
  day = dayKey(Date.now()),
  source = 'macros',
): Promise<void> {
  const id = weightIdFor(activeUserId, day)
  const existing = (await db.bodyWeights.get(id)) ?? (await byDay(day))

  if (existing) {
    if (existing.id === id) {
      await patch('bodyWeights', id, { kg, source, deletedAt: null })
      return
    }
    // A row from before ids were deterministic, or one pulled from another device. Tombstone it
    // so both copies don't count toward the trend.
    await patch('bodyWeights', existing.id, { deletedAt: Date.now() })
  }

  const row: BodyWeightRow = {
    id,
    userId: activeUserId,
    day,
    kg,
    source,
    ...syncStamp(),
  }
  await db.bodyWeights.put(row)
  await enqueue('bodyWeights', row.id)
}
