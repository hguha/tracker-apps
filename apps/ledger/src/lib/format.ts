// Display formatting. Every amount reaches the screen through here, so the minor-unit
// → currency-string conversion happens in exactly one place (the conversion-boundary
// rule). Money math never uses these — it stays in integer minor units.

import { formatMoney, money } from '@tracker-engine/core'
import { format, parseISO } from 'date-fns'

/** '-$45.00'. Pass a currency the account/entry carries; defaults to USD. */
export function fmtMoney(
  minor: number,
  currency = 'USD',
  opts: { signDisplay?: 'auto' | 'always' | 'never' } = {},
): string {
  return formatMoney(money(minor, currency), opts)
}

/** Absolute magnitude, no sign — for spend totals shown next to a category. */
export function fmtAbs(minor: number, currency = 'USD'): string {
  return formatMoney(money(Math.abs(minor), currency), { signDisplay: 'never' })
}

/** Whole-dollar, compact — for axis ticks and dense stats. */
export function fmtCompact(minor: number, currency = 'USD'): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(minor / 100)
}

export function fmtDate(iso: string): string {
  return format(parseISO(iso), 'MMM d')
}

export function fmtDateLong(iso: string): string {
  return format(parseISO(iso), 'EEE, MMM d, yyyy')
}

/** 0–1 → integer percent string. */
export function fmtPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}
