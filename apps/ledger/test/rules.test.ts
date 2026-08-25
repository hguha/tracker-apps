// Auto-categorization: pure matching + the repo apply path (rules retroactively
// categorize bank transactions via overrides and fill uncategorized manual entries).

import { beforeEach, describe, expect, it } from 'vitest'
import { syncStamp } from '@tracker-engine/local-first'
import { categoryForMerchant, ruleMatches } from '@/lib/rules'
import type { Rule } from '@/domain/types'
import { db } from '@/db'
import * as repo from '@/data/repository'
import { LedgerSyncEngine } from '@/sync/engine'
import { MockBankBackend } from '@/sync/mockBackend'
import { seedMockBackend } from '@/sync/mockData'

const rule = (over: Partial<Rule>): Rule => ({
  id: 'r1',
  merchantMatch: 'coffee',
  matchType: 'contains',
  categoryId: 'cat_dining',
  enabled: true,
  ...syncStamp(),
  ...over,
})

describe('rule matching (pure)', () => {
  it('contains is case-insensitive; equals is exact', () => {
    expect(ruleMatches(rule({}), 'Blue Bottle COFFEE')).toBe(true)
    expect(ruleMatches(rule({ matchType: 'equals', merchantMatch: 'Netflix' }), 'netflix')).toBe(true)
    expect(ruleMatches(rule({ matchType: 'equals', merchantMatch: 'Netflix' }), 'Netflix Inc')).toBe(false)
  })

  it('disabled and deleted rules never match', () => {
    expect(ruleMatches(rule({ enabled: false }), 'coffee')).toBe(false)
    expect(ruleMatches(rule({ deletedAt: Date.now() }), 'coffee')).toBe(false)
  })

  it('first matching rule wins', () => {
    const rules = [
      rule({ id: 'a', merchantMatch: 'blue', categoryId: 'cat_shopping' }),
      rule({ id: 'b', merchantMatch: 'bottle', categoryId: 'cat_dining' }),
    ]
    expect(categoryForMerchant('Blue Bottle', rules)).toBe('cat_shopping')
    expect(categoryForMerchant('Corner Store', rules)).toBeNull()
  })
})

describe('applyRules (repo)', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    await repo.seedIfNeeded()
    const backend = new MockBankBackend()
    seedMockBackend(backend)
    await new LedgerSyncEngine(backend).pull()
  })

  it('categorizes a matching bank transaction via a synced override', async () => {
    // Netflix is a seeded bank merchant. A rule routes it to Entertainment.
    await repo.addRule({ merchantMatch: 'Netflix', categoryId: 'cat_entertainment' })

    const netflix = (await repo.listLedgerEntries()).find((e) => e.merchant === 'Netflix')!
    expect(netflix.categoryId).toBe('cat_entertainment')
    // Written as an override, not by mutating the server-authored row.
    expect(await db.categoryOverrides.get(netflix.id)).toBeTruthy()
    expect((await db.transactions.get(netflix.id))?.categoryId).not.toBe('cat_entertainment')
  })

  it('fills an uncategorized manual entry and is idempotent', async () => {
    const id = await repo.addEntry({
      amountMinor: -650,
      date: '2026-08-20',
      merchant: 'Philz Coffee',
      categoryId: null,
    })
    await repo.addRule({ merchantMatch: 'coffee', categoryId: 'cat_dining' })

    expect((await repo.getEntry(id))?.categoryId).toBe('cat_dining')
    // Running again changes nothing more.
    expect(await repo.applyRules()).toBe(0)
  })
})
