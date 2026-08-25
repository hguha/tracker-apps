// Statement import parsing (the free data path) + the repo dedupe on import.

import { beforeEach, describe, expect, it } from 'vitest'
import { normalizeDate, parseCsv, parseOfx, parseStatement } from '@/lib/import'
import { db } from '@/db'
import * as repo from '@/data/repository'

describe('parseCsv', () => {
  it('parses a single signed amount column', () => {
    const csv = 'Date,Description,Amount\n2026-08-10,Whole Foods,-84.20\n08/12/2026,Payroll,4800.00'
    const { rows } = parseCsv(csv)
    expect(rows).toEqual([
      { date: '2026-08-10', merchant: 'Whole Foods', amountMinor: -8420 },
      { date: '2026-08-12', merchant: 'Payroll', amountMinor: 480000 },
    ])
  })

  it('handles separate debit/credit columns and quoted fields with commas', () => {
    const csv =
      'Date,Payee,Debit,Credit\n2026-08-03,"Blue Bottle, SF",5.50,\n2026-08-04,Refund,,12.00'
    const { rows } = parseCsv(csv)
    expect(rows[0]).toEqual({ date: '2026-08-03', merchant: 'Blue Bottle, SF', amountMinor: -550 })
    expect(rows[1]).toEqual({ date: '2026-08-04', merchant: 'Refund', amountMinor: 1200 })
  })

  it('warns when required columns are missing', () => {
    expect(parseCsv('Foo,Bar\n1,2').warnings.length).toBeGreaterThan(0)
  })
})

describe('parseOfx', () => {
  it('parses STMTTRN blocks (unclosed SGML tags, compact dates, signed amounts)', () => {
    const ofx = `<OFX><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260815120000<TRNAMT>-15.99<NAME>Netflix</STMTTRN>
      <STMTTRN><DTPOSTED>20260801<TRNAMT>4800.00<NAME>Acme Payroll</STMTTRN></OFX>`
    const { rows, format } = parseOfx(ofx)
    expect(format).toBe('ofx')
    expect(rows[0]).toEqual({ date: '2026-08-15', merchant: 'Netflix', amountMinor: -1599 })
    expect(rows[1]!.amountMinor).toBe(480000)
  })
})

describe('normalizeDate + dispatch', () => {
  it('normalizes ISO, compact, and US formats', () => {
    expect(normalizeDate('2026-08-10')).toBe('2026-08-10')
    expect(normalizeDate('20260810')).toBe('2026-08-10')
    expect(normalizeDate('8/10/26')).toBe('2026-08-10')
    expect(normalizeDate('nope')).toBeNull()
  })

  it('parseStatement routes OFX by content and CSV otherwise', () => {
    expect(parseStatement('x.txt', '<STMTTRN><TRNAMT>-1<DTPOSTED>20260101<NAME>A</STMTTRN>').format).toBe('ofx')
    expect(parseStatement('x.csv', 'Date,Description,Amount\n2026-01-01,A,-1').format).toBe('csv')
  })
})

describe('importEntries (repo)', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    await repo.seedIfNeeded()
  })

  it('imports new rows and skips duplicates on re-import', async () => {
    const rows = [
      { date: '2026-08-10', merchant: 'Whole Foods', amountMinor: -8420 },
      { date: '2026-08-12', merchant: 'Payroll', amountMinor: 480000 },
    ]
    const first = await repo.importEntries(rows)
    expect(first).toEqual({ added: 2, skipped: 0 })

    const second = await repo.importEntries(rows)
    expect(second).toEqual({ added: 0, skipped: 2 })

    const ledger = await repo.listLedgerEntries()
    expect(ledger.filter((e) => e.source === 'manual')).toHaveLength(2)
  })

  it('auto-categorizes imported rows via rules', async () => {
    await repo.addRule({ merchantMatch: 'Whole Foods', categoryId: 'cat_groceries' })
    await repo.importEntries([{ date: '2026-08-10', merchant: 'Whole Foods', amountMinor: -8420 }])
    const imported = (await repo.listLedgerEntries()).find((e) => e.merchant === 'Whole Foods')!
    expect(imported.categoryId).toBe('cat_groceries')
  })
})
