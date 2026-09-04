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
