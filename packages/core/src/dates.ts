import {
  differenceInCalendarDays,
  format,
  isSameDay,
  isSameYear,
  startOfDay,
  startOfWeek,
} from 'date-fns'

export type WeekStart = 0 | 1

// The one place raw millisecond spans live; app architecture checks ban them elsewhere.
export const DAY_MS = 86_400_000
export const WEEK_MS = 604_800_000

export function dayStart(ts: number): number {
  return startOfDay(ts).getTime()
}

export function weekStart(ts: number, weekStartsOn: WeekStart): number {
  return startOfWeek(ts, { weekStartsOn }).getTime()
}

/** Whole-week offset from the week containing `now`: 0 = this week, −1 = last. */
export function weekOffset(ts: number, weekStartsOn: WeekStart, now = Date.now()): number {
  return Math.round((weekStart(ts, weekStartsOn) - weekStart(now, weekStartsOn)) / WEEK_MS)
}

/** Sortable key for weekly buckets. */
export function weekKey(ts: number, weekStartsOn: WeekStart): string {
  return format(weekStart(ts, weekStartsOn), 'yyyy-MM-dd')
}

/** Sortable key for daily buckets, in local time. */
export function dayKey(ts: number): string {
  return format(ts, 'yyyy-MM-dd')
}

/** The day key `offset` days before `ts`. Derived from the calendar rather than by subtracting
 *  DAY_MS, so a DST boundary can't skip or repeat a day. */
export function dayKeyOffset(ts: number, offset: number): string {
  const date = new Date(ts)
  date.setDate(date.getDate() - offset)
  return dayKey(date.getTime())
}

export interface DayStreaks {
  /** Consecutive days ending today, or ending yesterday — today may just not be done yet. */
  current: number
  best: number
}

/**
 * Streaks over a set of day keys.
 *
 * Works on calendar keys rather than timestamps because a streak is a calendar fact: counting
 * by 24-hour spans makes the day a clock change lands on either two days or none.
 */
export function dayStreaks(days: Iterable<string>, now = Date.now()): DayStreaks {
  const present = new Set(days)
  if (present.size === 0) return { current: 0, best: 0 }

  const sorted = [...present].sort()
  let best = 0
  let run = 0
  let previous: string | null = null
  for (const day of sorted) {
    run = previous !== null && dayKeyOffset(dayNoon(day), 1) === previous ? run + 1 : 1
    if (run > best) best = run
    previous = day
  }

  // An unlogged today doesn't break the run: it isn't over.
  let cursor = present.has(dayKey(now)) ? dayKey(now) : dayKeyOffset(now, 1)
  let current = 0
  while (present.has(cursor)) {
    current += 1
    cursor = dayKeyOffset(dayNoon(cursor), 1)
  }

  return { current, best }
}

/** The YYYY-MM bucket an ISO date (yyyy-mm-dd) falls in. */
export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7)
}

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number) as [number, number]
  const total = y * 12 + (m - 1) + delta
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

/** The last `count` month keys ending at `endKey`, oldest first. */
export function recentMonths(endKey: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => shiftMonth(endKey, i - (count - 1)))
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number) as [number, number]
  const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', {
    month: 'short',
    timeZone: 'UTC',
  })
  return `${name} ${y}`
}

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
  return isSameYear(ts, now) ? format(ts, 'EEEE, MMM d') : format(ts, 'EEEE, MMM d, yyyy')
}

export function formatTimeOfDay(ts: number): string {
  return format(ts, 'h:mm a')
}

/** For <input type="datetime-local">, which wants local time with no zone. */
export function toDateTimeInputValue(ts: number): string {
  return format(ts, "yyyy-MM-dd'T'HH:mm")
}

export function fromDateTimeInputValue(value: string): number {
  return new Date(value).getTime()
}

export const dayNoon = (day: string): number => Date.parse(`${day}T12:00:00`)
