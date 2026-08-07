/**
 * Week-streak computation, shared by Home and the Badges screen (§5.2.1).
 *
 * Previously both screens computed the best streak inline, which had already
 * drifted — the Badges screen passed the *best* streak as the *current* one, so
 * a streak badge could evaluate differently in the two places. One function
 * removes that whole class of bug.
 *
 * Both streaks are measured in whole weeks with at least one finished session,
 * bucketed by the user's week start. Iterating the sorted set of trained weeks
 * (rather than stepping by a fixed 7-day span) keeps it correct across DST,
 * where a "week" isn't exactly 7×24h.
 */

import { weekStart, type WeekStart } from '@/lib/dates'

const WEEK_MS = 7 * 24 * 3600 * 1000

export interface Streaks {
  /** Consecutive trained weeks ending at the current week. An untrained current
   *  week doesn't break it (this week may just not be done *yet*). */
  currentWeekStreak: number
  /** Longest run of consecutive trained weeks anywhere in history. */
  bestWeekStreak: number
}

/**
 * @param startedAts  epoch-ms start times of finished workouts (any order)
 * @param weekStartsOn  0 = Sunday, 1 = Monday
 */
export function computeStreaks(startedAts: number[], weekStartsOn: WeekStart): Streaks {
  if (startedAts.length === 0) return { currentWeekStreak: 0, bestWeekStreak: 0 }

  // The distinct weeks that had at least one session, ascending.
  const trained = new Set(startedAts.map((at) => weekStart(at, weekStartsOn)))
  const weeks = [...trained].sort((a, b) => a - b)

  // Best: walk the sorted trained weeks; a gap wider than ~1 week resets the run.
  // The 1.5-week tolerance absorbs DST-shifted week boundaries.
  let bestWeekStreak = 0
  let run = 0
  let prev: number | null = null
  for (const w of weeks) {
    run = prev !== null && w - prev <= WEEK_MS * 1.5 ? run + 1 : 1
    if (run > bestWeekStreak) bestWeekStreak = run
    prev = w
  }

  // Current: count back from this week while each preceding week was trained.
  // An untrained current week is skipped, not counted as a break.
  const thisWeek = weekStart(Date.now(), weekStartsOn)
  let currentWeekStreak = 0
  let cursor = trained.has(thisWeek) ? thisWeek : thisWeek - WEEK_MS
  // Snap the cursor to a real week start after subtracting a raw span.
  cursor = weekStart(cursor, weekStartsOn)
  while (trained.has(cursor)) {
    currentWeekStreak += 1
    cursor = weekStart(cursor - WEEK_MS, weekStartsOn)
  }

  return { currentWeekStreak, bestWeekStreak }
}
