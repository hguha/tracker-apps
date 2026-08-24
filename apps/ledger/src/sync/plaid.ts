// The client half of the Plaid seam. These call the server-mediated Edge Functions
// (supabase/functions/plaid-*): the Plaid token stays server-side, the client only
// ever gets a short-lived link_token and, later, pulls the resulting server-authored
// rows through the normal sync path.
//
// Scaffolded: the functions return 503 until PLAID_* secrets are set, so these throw a
// clear "not configured" until then. Wiring: install react-plaid-link, open Link with
// createLinkToken()'s token, pass the public_token to exchangePublicToken(), then call
// syncTransactions() (or let a cron call plaid-sync). No app-code changes beyond the UI.

import { getSupabase } from '@/backend/supabaseClient'

async function invoke<T>(fn: string, body?: Record<string, unknown>): Promise<T> {
  const supabase = getSupabase()
  if (!supabase) throw new Error('Backend not configured')
  const { data, error } = await supabase.functions.invoke(fn, body ? { body } : {})
  if (error) throw error
  return data as T
}

/** Step 1: a Link token to open Plaid Link with. */
export function createLinkToken(): Promise<{ link_token: string }> {
  return invoke('plaid-link-token')
}

/** Step 2: exchange the Link public_token; the server stores the access_token. */
export function exchangePublicToken(publicToken: string): Promise<{ ok: true; item_id: string }> {
  return invoke('plaid-exchange', { public_token: publicToken })
}

/** Step 3: pull accounts + transactions into the (server-authored) tables. */
export function syncTransactions(): Promise<{ ok: true; accounts: number; transactions: number }> {
  return invoke('plaid-sync')
}
