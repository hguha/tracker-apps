import type { EatingWindow, LogEntry, Nutrients } from '@/domain/types'
import { sum } from '@/lib/nutrition'

/**
 * When food was eaten, independent of the breakfast/lunch/dinner labels.
 *
 * Those labels are a filing convention, not a description of how people eat: five small
 * occasions and one large one can both be filed as "lunch" and "dinner", and the difference
 * between them is exactly what someone asking about meal timing wants to see. So occasions are
 * derived from the clock — a gap in eating starts a new one — and the labels are left to do
 * their own, lesser job.
 */

/** A gap longer than this ends an eating occasion. Grazing over half an hour is one meal. */
export const OCCASION_GAP_MINUTES = 45

export interface Occasion {
  startAt: number
  endAt: number
  entries: LogEntry[]
  nutrients: Nutrients
}

export function eatingOccasions(
  entries: readonly LogEntry[],
  gapMinutes = OCCASION_GAP_MINUTES,
): Occasion[] {
  const ordered = [...entries].sort((a, b) => a.eatenAt - b.eatenAt)
  const groups: LogEntry[][] = []

  for (const entry of ordered) {
    const current = groups[groups.length - 1]
    const last = current?.[current.length - 1]
    if (current && last && entry.eatenAt - last.eatenAt <= gapMinutes * 60_000) current.push(entry)
    else groups.push([entry])
  }

  return groups.map((group) => ({
    startAt: group[0]!.eatenAt,
    endAt: group[group.length - 1]!.eatenAt,
    entries: group,
    nutrients: sum(group.map((entry) => entry.nutrients)),
  }))
}

export interface DayTiming {
  firstAt: number | null
  lastAt: number | null
  /** First bite to last, in minutes. Null with fewer than two occasions to span. */
  spanMinutes: number | null
  occasions: number
  /** Share of the day's calories eaten in its single largest occasion, 0–1. */
  largestShare: number | null
}

export function dayTiming(entries: readonly LogEntry[]): DayTiming {
  const occasions = eatingOccasions(entries)
  if (occasions.length === 0) {
    return { firstAt: null, lastAt: null, spanMinutes: null, occasions: 0, largestShare: null }
  }
  const firstAt = occasions[0]!.startAt
  const lastAt = occasions[occasions.length - 1]!.endAt
  const total = occasions.reduce((acc, o) => acc + o.nutrients.kcal, 0)
  const largest = Math.max(...occasions.map((o) => o.nutrients.kcal))

  return {
    firstAt,
    lastAt,
    spanMinutes: lastAt > firstAt ? Math.round((lastAt - firstAt) / 60_000) : null,
    occasions: occasions.length,
    largestShare: total > 0 ? largest / total : null,
  }
}

export const minutesIntoDay = (at: number): number => {
  const date = new Date(at)
  return date.getHours() * 60 + date.getMinutes()
}

export function formatClock(minute: number): string {
  const hours = Math.floor(minute / 60) % 24
  const minutes = Math.round(minute % 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/**
 * The inverse of `formatClock`: "07:30" back to minutes from midnight.
 *
 * Exists so a reminder time can be an `<input type="time">` — whose value format is exactly what
 * `formatClock` already emits — instead of a row of preset pills. The presets were the problem: five
 * half-hourly options per meal meant nobody whose lunch is at 12:15 could be reminded about it.
 */
export function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

export function formatDuration(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes))
  const hours = Math.floor(whole / 60)
  return hours === 0 ? `${whole}m` : `${hours}h ${String(whole % 60).padStart(2, '0')}m`
}

export type WindowPhase = 'before' | 'open' | 'after'

export interface WindowState {
  phase: WindowPhase
  /** Minutes until the window opens, when it hasn't. */
  opensInMinutes: number | null
  /** Minutes left in the window, when it's open. */
  closesInMinutes: number | null
  /** How long since the last thing eaten, whenever that was. */
  fastedMinutes: number | null
}

/**
 * Where `now` sits relative to the eating window.
 *
 * Windows that cross midnight (an 18:00–02:00 eater) are handled by treating the end as being
 * on the next day, because the alternative — refusing to model them — pushes exactly the people
 * who care most about timing into a display that's wrong for them every night.
 */
export function windowState(
  window: EatingWindow,
  entries: readonly LogEntry[],
  now = Date.now(),
): WindowState {
  const { end, adjusted } = unwrap(window, now)
  const timing = dayTiming(entries)
  const fastedMinutes =
    timing.lastAt === null ? null : Math.max(0, Math.round((now - timing.lastAt) / 60_000))

  if (adjusted < window.startMinute) {
    return {
      phase: 'before',
      opensInMinutes: window.startMinute - adjusted,
      closesInMinutes: null,
      fastedMinutes,
    }
  }
  if (adjusted <= end) {
    return {
      phase: 'open',
      opensInMinutes: null,
      closesInMinutes: end - adjusted,
      fastedMinutes,
    }
  }
  return { phase: 'after', opensInMinutes: null, closesInMinutes: null, fastedMinutes }
}

/**
 * How far through the eating window the day is, 0–1.
 *
 * The only honest basis for "you're behind on calories": without a window, the app has no idea
 * whether someone at 1,200 kcal by 3pm is behind or exactly on plan, so pacing is offered only
 * to people who have told it when they eat.
 */
export function windowProgress(window: EatingWindow, now = Date.now()): number {
  const { end, adjusted } = unwrap(window, now)
  const span = end - window.startMinute
  if (span <= 0) return 0
  return Math.min(1, Math.max(0, (adjusted - window.startMinute) / span))
}

/**
 * Puts `now` and the window's end on one continuous line.
 *
 * Only the small hours belong to the previous evening's window: 3pm on an 18:00–02:00 schedule is
 * *before* tonight's window, not after last night's. Deciding that by "is it before the start"
 * instead of "is it before the end" put the whole afternoon in yesterday's window.
 */
function unwrap(window: EatingWindow, now: number): { end: number; adjusted: number } {
  const minute = minutesIntoDay(now)
  const crossesMidnight = window.endMinute <= window.startMinute
  return {
    end: crossesMidnight ? window.endMinute + 24 * 60 : window.endMinute,
    adjusted: crossesMidnight && minute < window.endMinute ? minute + 24 * 60 : minute,
  }
}
