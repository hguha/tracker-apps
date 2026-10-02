import { LOCAL_USER_ID } from '@tracker-engine/auth'
import { db } from '@/db'
import { type LogEntry } from '@/domain/types'

export let activeUserId = LOCAL_USER_ID

export function setActiveUserId(userId: string): void {
  activeUserId = userId
}

/**
 * Where a row sits within its day.
 *
 * The timestamp, plus a counter — because a dish is written as several rows inside the same
 * millisecond, so `sortIndex: eatenAt` gave all of them the same position and left the order to
 * whatever IndexedDB returned. The parts of "3 steak tacos" then listed in a different order on
 * different devices, and a recipe's ingredients came out shuffled from the order they were entered.
 *
 * Milliseconds rather than a separate fraction, so old rows (which stored the bare timestamp) stay
 * comparable with new ones. A shift of under a second cannot reorder anything a person would notice.
 */
let sortSequence = 0

export function nextSortIndex(eatenAt: number): number {
  sortSequence = (sortSequence + 1) % 900
  return eatenAt + sortSequence
}

export const noonOf = (day: string): number => Date.parse(`${day}T12:00:00`)

/**
 * Oldest first. A total order, which is the point.
 *
 * Ids are random UUIDs and a multi-select writes several rows inside one millisecond, so `eatenAt`
 * alone leaves "last time" up to whatever order IndexedDB returned — and `lastAmountFor` is the thing
 * that makes logging fast, so it has to give the same answer twice. When two rows tie on time they are
 * equally recent; all that matters is that the tie is broken the same way every run.
 */
export const byRecency = (a: LogEntry, b: LogEntry): number =>
  a.eatenAt - b.eatenAt || a.createdAt - b.createdAt || a.id.localeCompare(b.id)

export const isLater = (a: LogEntry, b: LogEntry): boolean => byRecency(a, b) > 0

export const isPresent = (value: string | null): value is string => value !== null

export const byDay = (day: string) => db.bodyWeights.where('day').equals(day).filter(alive).first()

export function alive(row: { deletedAt: number | null }): boolean {
  return row.deletedAt === null
}
