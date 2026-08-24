// The aggregation seam — the one place "where does bank data come from?" is decided,
// so swapping the mock for real Plaid is a drop-in here and nowhere else.
//
// How real aggregation works (server-mediated, principle #8 — tokens never touch the
// client): the app opens Plaid Link, exchanges the public token in the `plaid-exchange`
// Edge Function (which stores the Plaid access_token server-side), and a `plaid-sync`
// function pulls transactions from Plaid and writes them into the user's Supabase
// `accounts`/`transactions` rows. Those tables are server-authored (see ledgerSchema),
// so the client only ever PULLS them through the standard SupabaseBackend — it cannot
// forge a bank row, which is the security boundary. See sync/plaid.ts for the contract.
//
// Until Plaid keys are wired, the mock backend serves a seeded feed through the exact
// same SyncBackend interface, so the whole app (pull, categorize, insights, coach) runs
// end-to-end offline.

import { getSupabase } from '@/backend/supabaseClient'
import { SupabaseBackend } from '@tracker-engine/local-first'
import type { SyncBackend } from '@tracker-engine/local-first'
import { MockBankBackend } from './mockBackend'
import { seedMockBackend } from './mockData'

export interface BankSource {
  backend: SyncBackend
  /** True when serving the seeded demo feed rather than a real aggregation server. */
  isMock: boolean
}

// Memoized so the mock is seeded once and the engine sees a stable backend.
let cached: BankSource | undefined

export function bankSource(): BankSource {
  if (cached) return cached
  const client = getSupabase()
  if (client) {
    cached = { backend: new SupabaseBackend(client), isMock: false }
  } else {
    const mock = new MockBankBackend()
    seedMockBackend(mock)
    cached = { backend: mock, isMock: true }
  }
  return cached
}
