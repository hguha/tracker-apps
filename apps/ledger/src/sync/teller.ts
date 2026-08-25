// The client half of the Teller seam (the recommended aggregator — free for up to 100
// connections). Teller Connect runs in the browser and hands back an access_token +
// enrollment id; we store them server-side (the token never persists in the client),
// then a server function pulls the bank data into the pull-only tables.
//
// Wiring: load Teller Connect (https://cdn.teller.io/connect/connect.js), open it with
// your Teller application id, and on success call storeEnrollment() with the returned
// accessToken + enrollment.id, then syncTransactions(). No app-code changes beyond the
// "Connect a bank" button. See supabase/README.md for the cert + secrets setup.

import { getSupabase } from '@/backend/supabaseClient'

async function invoke<T>(fn: string, body?: Record<string, unknown>): Promise<T> {
  const supabase = getSupabase()
  if (!supabase) throw new Error('Backend not configured')
  const { data, error } = await supabase.functions.invoke(fn, body ? { body } : {})
  if (error) throw error
  return data as T
}

/** Persist a completed Teller Connect enrollment server-side. */
export function storeEnrollment(input: {
  accessToken: string
  enrollmentId: string
  institution?: string
}): Promise<{ ok: true }> {
  return invoke('teller-store-enrollment', input)
}

/** Pull accounts + transactions into the (server-authored) tables. */
export function syncTransactions(): Promise<{ ok: true; accounts: number; transactions: number }> {
  return invoke('teller-sync')
}
