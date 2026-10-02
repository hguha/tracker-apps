import { syncStamp } from '@tracker-engine/local-first'
import { db } from '@/db'
import { enqueue, patch } from '@/data/outbox'
import { type WaterRow } from '@/domain/types'
import { activeUserId, alive } from './internal'

/**
 * A day's water, by a deterministic id.
 *
 * `w:${userId}:${day}` rather than a random id, for the same reason weigh-ins use one: tapping
 * "+ a glass" eight times is eight edits to one running total, not eight events, and two devices
 * that each recorded some of a day's water must converge on one row rather than accumulate two.
 */
const waterId = (day: string): string => `w:${activeUserId}:${day}`

export function waterForDay(day: string): Promise<WaterRow | undefined> {
  return db.waterLogs.get(waterId(day))
}

export function waterBetween(fromDay: string, toDay: string): Promise<WaterRow[]> {
  return db.waterLogs.where('day').between(fromDay, toDay, true, true).filter(alive).toArray()
}

/** Adds (or, with a negative delta, removes) water. Never goes below zero. */
export async function addWater(day: string, deltaMl: number): Promise<number> {
  const id = waterId(day)
  const existing = await db.waterLogs.get(id)
  const ml = Math.max(0, Math.round((existing?.ml ?? 0) + deltaMl))

  if (existing) {
    await patch('waterLogs', id, { ml, deletedAt: null })
    return ml
  }
  const row: WaterRow = { id, userId: activeUserId, day, ml, ...syncStamp() }
  await db.waterLogs.put(row)
  await enqueue('waterLogs', id)
  return ml
}
