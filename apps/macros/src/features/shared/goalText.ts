import { DAY_MS, WEEK_MS, convertWeight, formatRelativeDay, signed, type WeightUnit } from '@tracker-engine/core'

export const arrivalDay = (at: number, now = Date.now()): string => formatRelativeDay(at, now)

export function timeUntil(at: number, now = Date.now()): string {
  const days = Math.max(0, Math.round((at - now) / DAY_MS))
  if (days < 10) return days === 1 ? '1 day' : `${days} days`
  const weeks = Math.round((at - now) / WEEK_MS)
  if (weeks < 17) return `${weeks} wk`
  return `${Math.round(weeks / 4.345)} mo`
}

export const perWeek = (kg: number, unit: WeightUnit): string =>
  `${signed(convertWeight(kg, unit), 1)} ${unit}/wk`

export function arrivalRange(
  earliestAt: number | null,
  latestAt: number | null,
  now = Date.now(),
): string | null {
  if (earliestAt === null) return null
  const from = formatRelativeDay(earliestAt, now)
  return latestAt === null ? `${from} or later` : `${from} – ${formatRelativeDay(latestAt, now)}`
}
