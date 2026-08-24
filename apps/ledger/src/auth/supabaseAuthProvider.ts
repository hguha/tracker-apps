// Ledger's Supabase auth provider — the shared SupabaseAuthProvider bound to Ledger's
// native custom scheme. Same infra as REPutation, different scheme + storage key.
import { SupabaseAuthProvider } from '@tracker-engine/auth'
import type { SupabaseClient } from '@supabase/supabase-js'

// Must match the iOS/Android scheme and be in Supabase's Redirect URL allowlist.
const NATIVE_REDIRECT_URL = 'ledger://auth-callback'

export class LedgerAuthProvider extends SupabaseAuthProvider {
  constructor(client: SupabaseClient) {
    super(client, { nativeRedirectUrl: NATIVE_REDIRECT_URL })
  }
}
