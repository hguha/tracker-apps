// Date primitives. The one place raw millisecond spans live (the architecture
// check bans them everywhere else), plus the month helpers every screen shares so
// "this month" means the same thing in the overview, insights, and budgets.

export const DAY_MS = 86_400_000
export const WEEK_MS = 604_800_000

/** The YYYY-MM bucket an ISO date (yyyy-mm-dd) falls in. */
export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7)
}

/** YYYY-MM for `monthsAgo` months before the given month key (default: shift within). */
export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number) as [number, number]
  const total = y * 12 + (m - 1) + delta
  const year = Math.floor(total / 12)
  const month = (total % 12) + 1
  return `${year}-${String(month).padStart(2, '0')}`
}

/** The last `count` month keys ending at `endKey`, oldest first. */
export function recentMonths(endKey: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => shiftMonth(endKey, i - (count - 1)))
}

/** A stable human label for a YYYY-MM key, e.g. "Aug 2026". */
export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number) as [number, number]
  const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', {
    month: 'short',
    timeZone: 'UTC',
  })
  return `${name} ${y}`
}
