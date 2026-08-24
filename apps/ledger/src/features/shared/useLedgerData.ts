// The one live-query the tab screens share, so Overview, History, and Insights all
// read the same ledger and never disagree. `currentMonth` is the latest month that
// actually has activity (deterministic for the demo, and never an empty screen if the
// device clock drifts), with `currentEntries` pre-filtered to it.

import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import * as repo from '@/data/repository'
import { monthKey } from '@/lib/dates'
import type { Account, Budget, Category, LedgerEntry } from '@/domain/types'

export interface LedgerData {
  accounts: Account[]
  entries: LedgerEntry[]
  categories: Category[]
  budgets: Budget[]
  categoryMap: Map<string, Category>
  months: string[] // YYYY-MM present in the ledger, oldest → newest
  currentMonth: string | null
  currentEntries: LedgerEntry[]
  loading: boolean
}

export function useLedgerData(): LedgerData {
  const data = useLiveQuery(async () => {
    const [accounts, entries, categories, budgets] = await Promise.all([
      repo.listAccounts(),
      repo.listLedgerEntries(),
      repo.listCategories(),
      repo.listBudgets(),
    ])
    return { accounts, entries, categories, budgets }
  }, [])

  return useMemo(() => {
    const accounts = data?.accounts ?? []
    const entries = data?.entries ?? []
    const categories = data?.categories ?? []
    const budgets = data?.budgets ?? []
    const categoryMap = new Map(categories.map((c) => [c.id, c]))
    const months = [...new Set(entries.map((e) => monthKey(e.date)))].sort()
    const currentMonth = months.at(-1) ?? null
    const currentEntries = currentMonth
      ? entries.filter((e) => monthKey(e.date) === currentMonth)
      : []
    return {
      accounts,
      entries,
      categories,
      budgets,
      categoryMap,
      months,
      currentMonth,
      currentEntries,
      loading: data === undefined,
    }
  }, [data])
}
