// Week-streak computation shared by Home and Badges (§5.2.1). Iterates the sorted
// set of trained weeks rather than a fixed 7-day span, so it stays correct across DST.

import { WEEK_MS, weekStart, type WeekStart } from '@/lib/dates'

export interface Streaks {
  /** Consecutive trained weeks ending at the current week. An untrained current
   *  week doesn't break it (this week may just not be done *yet*). */
  currentWeekStreak: number
  /** Longest run of consecutive trained weeks anywhere in history. */
  bestWeekStreak: number
}

/** @param weekStartsOn 0 = Sunday, 1 = Monday */
export function computeStreaks(startedAts: number[], weekStartsOn: WeekStart): Streaks {
  if (startedAts.length === 0) return { currentWeekStreak: 0, bestWeekStreak: 0 }

  const trained = new Set(startedAts.map((at) => weekStart(at, weekStartsOn)))
  const weeks = [...trained].sort((a, b) => a - b)

  // A gap wider than ~1.5 weeks resets the run; the tolerance absorbs DST-shifted boundaries.
  let bestWeekStreak = 0
  let run = 0
  let prev: number | null = null
  for (const w of weeks) {
    run = prev !== null && w - prev <= WEEK_MS * 1.5 ? run + 1 : 1
    if (run > bestWeekStreak) bestWeekStreak = run
    prev = w
  }

  // Count back from this week while each preceding week was trained; an untrained
  // current week is skipped, not counted as a break.
  const thisWeek = weekStart(Date.now(), weekStartsOn)
  let currentWeekStreak = 0
  let cursor = trained.has(thisWeek) ? thisWeek : thisWeek - WEEK_MS
  // Snap to a real week start after subtracting a raw span.
  cursor = weekStart(cursor, weekStartsOn)
  while (trained.has(cursor)) {
    currentWeekStreak += 1
    cursor = weekStart(cursor - WEEK_MS, weekStartsOn)
  }

  return { currentWeekStreak, bestWeekStreak }
}
