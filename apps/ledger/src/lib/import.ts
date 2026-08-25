// Statement import — the free, aggregator-independent data path. Parses a bank's
// exported CSV or OFX/QFX into normalized transactions (integer minor units, outflow
// negative). Pure and format-tolerant so it's testable and works across banks. The
// repository turns these into client-authored manual entries, deduped.

export interface ParsedTxn {
  date: string // ISO yyyy-mm-dd
  merchant: string
  amountMinor: number // outflow negative
}

export interface ParseResult {
  rows: ParsedTxn[]
  format: 'csv' | 'ofx'
  warnings: string[]
}

const money = (raw: string): number | null => {
  const cleaned = raw.replace(/[^0-9.\-()]/g, '').trim()
  if (!cleaned) return null
  // Accounting negatives: (12.34) → -12.34
  const negParen = /^\(.*\)$/.test(cleaned)
  const n = Number(cleaned.replace(/[()]/g, ''))
  if (!Number.isFinite(n)) return null
  return Math.round((negParen ? -n : n) * 100)
}

/** Normalize common date formats to ISO yyyy-mm-dd. */
export function normalizeDate(raw: string): string | null {
  const s = raw.trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s) // ISO / OFX (first 8 of DTPOSTED)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /^(\d{4})(\d{2})(\d{2})/.exec(s) // OFX compact YYYYMMDD
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(s) // US M/D/Y
  if (m) {
    const [, mo, d, y] = m
    const year = y!.length === 2 ? `20${y}` : y!
    return `${year}-${mo!.padStart(2, '0')}-${d!.padStart(2, '0')}`
  }
  return null
}

// A minimal CSV row splitter that respects double-quoted fields.
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]!
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i += 1
      } else if (c === '"') inQuotes = false
      else cur += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

const findCol = (headers: string[], patterns: RegExp[]): number =>
  headers.findIndex((h) => patterns.some((p) => p.test(h)))

export function parseCsv(text: string): ParseResult {
  const warnings: string[] = []
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) return { rows: [], format: 'csv', warnings: ['No data rows found.'] }

  const headers = splitCsvLine(lines[0]!).map((h) => h.toLowerCase())
  const dateCol = findCol(headers, [/date/])
  const descCol = findCol(headers, [/description|name|payee|merchant|memo|detail/])
  const amountCol = findCol(headers, [/amount|value/])
  const debitCol = findCol(headers, [/debit|withdrawal|outflow/])
  const creditCol = findCol(headers, [/credit|deposit|inflow/])

  if (dateCol < 0 || descCol < 0 || (amountCol < 0 && debitCol < 0 && creditCol < 0)) {
    return {
      rows: [],
      format: 'csv',
      warnings: ['Could not find date, description, and amount columns in the header.'],
    }
  }

  const rows: ParsedTxn[] = []
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line)
    const date = normalizeDate(cells[dateCol] ?? '')
    const merchant = (cells[descCol] ?? '').trim()
    if (!date || !merchant) continue

    let amountMinor: number | null = null
    if (amountCol >= 0) {
      amountMinor = money(cells[amountCol] ?? '')
    } else {
      // Separate debit/credit columns: debit is an outflow, credit an inflow.
      const debit = debitCol >= 0 ? money(cells[debitCol] ?? '') : null
      const credit = creditCol >= 0 ? money(cells[creditCol] ?? '') : null
      if (debit) amountMinor = -Math.abs(debit)
      else if (credit) amountMinor = Math.abs(credit)
    }
    if (amountMinor === null) continue
    rows.push({ date, merchant, amountMinor })
  }
  if (rows.length === 0) warnings.push('No rows could be parsed from this file.')
  return { rows, format: 'csv', warnings }
}

// OFX/QFX is SGML-ish; tags are often unclosed, so match per <STMTTRN> block.
export function parseOfx(text: string): ParseResult {
  const warnings: string[] = []
  const rows: ParsedTxn[] = []
  const tag = (block: string, name: string): string | null => {
    const m = new RegExp(`<${name}>([^<\\r\\n]*)`, 'i').exec(block)
    return m ? m[1]!.trim() : null
  }
  const blocks = text.split(/<STMTTRN>/i).slice(1)
  for (const block of blocks) {
    const date = normalizeDate(tag(block, 'DTPOSTED') ?? '')
    const amt = tag(block, 'TRNAMT')
    const merchant = (tag(block, 'NAME') ?? tag(block, 'MEMO') ?? '').trim()
    if (!date || amt === null || !merchant) continue
    const amountMinor = money(amt)
    if (amountMinor === null) continue
    rows.push({ date, merchant, amountMinor })
  }
  if (rows.length === 0) warnings.push('No <STMTTRN> transactions found in this OFX file.')
  return { rows, format: 'ofx', warnings }
}

/** Dispatch by content (OFX marker) then extension, defaulting to CSV. */
export function parseStatement(filename: string, text: string): ParseResult {
  const isOfx = /<OFX>|<STMTTRN>/i.test(text) || /\.(ofx|qfx)$/i.test(filename)
  return isOfx ? parseOfx(text) : parseCsv(text)
}

/** A stable key for deduping an imported row against existing activity. */
export function dedupeKey(t: { date: string; merchant: string; amountMinor: number }): string {
  return `${t.date}|${t.merchant.trim().toLowerCase()}|${t.amountMinor}`
}
