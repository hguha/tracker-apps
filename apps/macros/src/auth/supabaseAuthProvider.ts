import { SupabaseAuthProvider } from '@tracker-engine/auth'
import type { SupabaseClient } from '@supabase/supabase-js'

// Must match the iOS/Android scheme and Supabase's redirect allowlist.
const NATIVE_REDIRECT_URL = 'macros://auth-callback'

export class MacrosAuthProvider extends SupabaseAuthProvider {
  constructor(client: SupabaseClient) {
    super(client, { nativeRedirectUrl: NATIVE_REDIRECT_URL })
  }
}
