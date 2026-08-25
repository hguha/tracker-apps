// AI categorization maps uncategorized merchants → rules, which then categorize the
// activity. The Gemini call is injected so this stays deterministic and offline.

import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import * as repo from '@/data/repository'
import { autoCategorize } from '@/features/settings/aiCategorize'

beforeEach(async () => {
  await db.delete()
  await db.open()
  await repo.seedIfNeeded()
})

describe('autoCategorize', () => {
  it('creates rules from assignments and applies them to uncategorized entries', async () => {
    await repo.importEntries([
      { date: '2026-08-10', merchant: 'Philz Coffee', amountMinor: -650 },
      { date: '2026-08-11', merchant: 'Shell Gas', amountMinor: -4200 },
    ])

    const fakeCall = async (merchants: string[]) => {
      expect(merchants).toContain('Philz Coffee')
      return [
        { merchant: 'Philz Coffee', categoryId: 'cat_dining' },
        { merchant: 'Shell Gas', categoryId: 'cat_transport' },
      ]
    }

    const { created, considered } = await autoCategorize(fakeCall)
    expect(created).toBe(2)
    expect(considered).toBe(2)

    const ledger = await repo.listLedgerEntries()
    expect(ledger.find((e) => e.merchant === 'Philz Coffee')?.categoryId).toBe('cat_dining')
    expect(ledger.find((e) => e.merchant === 'Shell Gas')?.categoryId).toBe('cat_transport')
  })

  it('no-ops when nothing is uncategorized', async () => {
    const result = await autoCategorize(async () => {
      throw new Error('should not be called')
    })
    expect(result).toEqual({ created: 0, considered: 0 })
  })
})
