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

/** Weigh-ins that came from Health rather than from this app. */
const HEALTH_SOURCE = 'apple-health'

export interface WeightImport {
  day: string
  kg: number
  at: number
}

/**
 * Brings weigh-ins in from Health.
 *
 * Two rules, both about not overwriting the user:
 *
 * 1. A day already weighed in *in this app* is left alone. Someone who typed 80.4 here meant it,
 *    and a smart scale's later reading that evening shouldn't silently replace it.
 * 2. Where a day has several samples, the earliest is used. Weight drifts up over a day by a kilo
 *    or more, so mixing morning and evening readings would add noise the trend then has to smooth
 *    back out — a consistent time of day matters more than which time.
 */
export async function importWeights(samples: readonly WeightImport[]): Promise<number> {
  const earliestPerDay = new Map<string, WeightImport>()
  for (const sample of samples) {
    const current = earliestPerDay.get(sample.day)
    if (!current || sample.at < current.at) earliestPerDay.set(sample.day, sample)
  }

  let imported = 0
  for (const sample of earliestPerDay.values()) {
    const existing = await db.bodyWeights.get(weightIdFor(activeUserId, sample.day))
    if (existing && existing.deletedAt === null && existing.source !== HEALTH_SOURCE) continue
    if (existing?.kg === sample.kg && existing.source === HEALTH_SOURCE) continue

    await recordWeight(Math.round(sample.kg * 10) / 10, sample.day, HEALTH_SOURCE)
    imported += 1
  }
  return imported
}
