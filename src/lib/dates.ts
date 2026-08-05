/**
 * All date bucketing and formatting (§5.7). Centralized because timezone and
 * week-start bugs are silent: a workout logged at 11pm landing in the wrong
 * week shifts a chart by one bar and nothing errors.
 *
 * FitNoter's date formatter emitted "010" for October. That class of bug is
 * why none of this is inlined at call sites.
 */

import {
  differenceInCalendarDays,
  endOfWeek,
  format,
  isSameDay,
  isSameYear,
  startOfDay,
  startOfWeek,
} from 'date-fns'

/** Matches date-fns' expectation, and `profiles.week_starts_on`. */
export type WeekStart = 0 | 1

export function dayStart(ts: number): number {
  return startOfDay(ts).getTime()
}

export function weekStart(ts: number, weekStartsOn: WeekStart): number {
  return startOfWeek(ts, { weekStartsOn }).getTime()
}

export function weekEnd(ts: number, weekStartsOn: WeekStart): number {
  return endOfWeek(ts, { weekStartsOn }).getTime()
}

/** Key for grouping into weekly buckets. Sortable as a string. */
export function weekKey(ts: number, weekStartsOn: WeekStart): string {
  return format(weekStart(ts, weekStartsOn), 'yyyy-MM-dd')
}

/**
 * "Today" / "Yesterday" / "Jul 21" / "Jul 21, 2024".
 *
 * The last-time header is read mid-set, so relative wording for the recent
 * past is worth the branch — "3 days ago" answers the question directly.
 */
export function formatRelativeDay(ts: number, now = Date.now()): string {
  if (isSameDay(ts, now)) return 'Today'
  const daysAgo = differenceInCalendarDays(now, ts)
  if (daysAgo === 1) return 'Yesterday'
  if (daysAgo > 1 && daysAgo < 7) return `${daysAgo} days ago`
  return isSameYear(ts, now) ? format(ts, 'MMM d') : format(ts, 'MMM d, yyyy')
}

export function formatDayHeading(ts: number, now = Date.now()): string {
  if (isSameDay(ts, now)) return 'Today'
  if (differenceInCalendarDays(now, ts) === 1) return 'Yesterday'
  return isSameYear(ts, now)
    ? format(ts, 'EEEE, MMM d')
    : format(ts, 'EEEE, MMM d, yyyy')
}

export function formatTimeOfDay(ts: number): string {
  return format(ts, 'h:mm a')
}

/** For `<input type="datetime-local">`, which wants local time, no zone. */
export function toDateTimeInputValue(ts: number): string {
  return format(ts, "yyyy-MM-dd'T'HH:mm")
}

export function fromDateTimeInputValue(value: string): number {
  return new Date(value).getTime()
}

export function daysBetween(a: number, b: number): number {
  return Math.abs(differenceInCalendarDays(a, b))
}
