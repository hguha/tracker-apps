import type { MealSlot, Venue } from '@/domain/types'

/**
 * Where a log write is going: which meal, when, and where it was eaten.
 *
 * One object rather than three props, because every panel on the log screen needs all of it and
 * each one was separately threading `meal` and `at` down. Adding "where" made that four parameters
 * repeated across six components — the point at which the parameters are obviously a thing.
 */
export interface LogTarget {
  meal: MealSlot
  at: number
  venue: Venue | null
}
