import type { SupabaseClient } from '@supabase/supabase-js'
import { CompositeAuthProvider as BaseCompositeAuthProvider } from '@tracker-engine/auth'
import { LocalAuthProvider } from './localAuthProvider'
import { SupabaseAuthProvider } from './supabaseAuthProvider'

export class CompositeAuthProvider extends BaseCompositeAuthProvider {
  constructor(client: SupabaseClient) {
    super(new SupabaseAuthProvider(client), new LocalAuthProvider())
  }
}
