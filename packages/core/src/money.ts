// Money in integer minor units (cents), never floats — the finance analogue of the
// workout app storing weight canonically in kg. Formatting and parsing live here so
// every screen, chart, and the coach agree on the same numbers (the calc-consistency
// rule the workout app learned the hard way, applied from day one). This is the first
// piece of Ledger-specific shared code; REPutation doesn't use it yet.

export interface Money {
  /** Integer minor units, e.g. cents. Outflows are negative by convention. */
  readonly minor: number
  /** ISO 4217 code, e.g. 'USD'. */
  readonly currency: string
}

// Currencies whose minor unit isn't 1/100 (JPY has none); default to 2.
const MINOR_DIGITS: Record<string, number> = { USD: 2, EUR: 2, GBP: 2, CAD: 2, JPY: 0 }

export function minorDigits(currency: string): number {
  return MINOR_DIGITS[currency] ?? 2
}

export function money(minor: number, currency = 'USD'): Money {
  return { minor: Math.round(minor), currency }
}

/** Parse a user-entered amount ('1,234.56', '-$45') into whole minor units, or null. */
export function parseMoney(raw: string, currency = 'USD'): Money | null {
  const cleaned = raw.replace(/[^0-9.\-]/g, '').trim()
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  return { minor: Math.round(n * 10 ** minorDigits(currency)), currency }
}

/** Format for display, e.g. formatMoney(money(-4500)) -> '-$45.00'. */
export function formatMoney(
  m: Money,
  opts: { signDisplay?: 'auto' | 'always' | 'never' } = {},
): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: m.currency,
    signDisplay: opts.signDisplay ?? 'auto',
  }).format(m.minor / 10 ** minorDigits(m.currency))
}

/** Sum amounts of one currency; throws on a mismatch rather than silently adding. */
export function sumMoney(amounts: readonly Money[], currency = 'USD'): Money {
  let minor = 0
  for (const a of amounts) {
    if (a.currency !== currency) {
      throw new Error(`currency mismatch: ${a.currency} vs ${currency}`)
    }
    minor += a.minor
  }
  return { minor, currency }
}
