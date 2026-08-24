// The offline coach must give real, data-driven answers with no network (principle #9).

import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import * as repo from '@/data/repository'
import { mockCoachProvider } from '@/features/coach/mockProvider'
import type { GeminiContent } from '@/features/coach/types'

const ctx = { month: null, currency: 'USD' }
const ask = (text: string): GeminiContent[] => [{ role: 'user', parts: [{ text }] }]

beforeEach(async () => {
  await db.delete()
  await db.open()
  await repo.seedIfNeeded()
  // A couple of spends so the coach has something to compute.
  await repo.addEntry({ amountMinor: 480_000, date: '2026-08-01', merchant: 'Payroll', categoryId: 'cat_income' })
  await repo.addEntry({ amountMinor: -9_000, date: '2026-08-05', merchant: 'Market', categoryId: 'cat_groceries' })
})

describe('mock coach', () => {
  it('is always available', async () => {
    expect(await mockCoachProvider.isAvailable()).toBe(true)
  })

  it('answers a spending question with real numbers and appends a model turn', async () => {
    const result = await mockCoachProvider.chat(ask("where's my money going?"), ctx)
    expect(result.text).toMatch(/\$/)
    expect(result.text.toLowerCase()).toContain('groceries')
    expect(result.contents.at(-1)).toEqual({ role: 'model', parts: [{ text: result.text }] })
  })

  it('proposes a budget action for a budget request', async () => {
    const result = await mockCoachProvider.chat(ask('help me set a budget'), ctx)
    expect(result.action?.kind).toBe('budget')
    expect(result.action?.limitMinor).toBeGreaterThan(0)
  })
})
