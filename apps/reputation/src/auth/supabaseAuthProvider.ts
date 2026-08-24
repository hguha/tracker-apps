// REPutation's Supabase provider = the generic one from @tracker-engine/auth, bound
// to the app's native custom scheme. Kept as a 1-arg subclass so existing call sites
// (CompositeAuthProvider) construct `new SupabaseAuthProvider(client)` unchanged.
import type { SupabaseClient } from '@supabase/supabase-js'
import { SupabaseAuthProvider as CoreSupabaseAuthProvider } from '@tracker-engine/auth'

export class SupabaseAuthProvider extends CoreSupabaseAuthProvider {
  constructor(client: SupabaseClient) {
    super(client, { nativeRedirectUrl: 'fitnote://auth-callback' })
  }
}
