import { createAuthScope } from '@tracker-engine/auth/react'
import { CompositeAuthProvider, LOCAL_USER_ID, type AuthProvider } from '@tracker-engine/auth'
import { ownerTransition, type OwnerTransition } from '@tracker-engine/local-first'
import { getSupabase } from '@/backend/supabaseClient'
import * as repo from '@/data/repository'
import { LocalAuthProvider } from './localAuthProvider'
import { MacrosAuthProvider } from './supabaseAuthProvider'

const supabase = getSupabase()

/**
 * Composed, not either/or. With a project configured the app still has to offer "use this
 * device only" — the Supabase provider has no such path, so picking one provider broke
 * device-only mode outright whenever env was present.
 */
const composite = supabase
  ? new CompositeAuthProvider(new MacrosAuthProvider(supabase), new LocalAuthProvider())
  : null
const provider: AuthProvider = composite ?? new LocalAuthProvider()

export const { AuthProviderScope, useAuth } = createAuthScope<OwnerTransition>({
  provider,
  isLocalOnly: supabase === null,
  localUserId: LOCAL_USER_ID,
  onPasswordRecovery: (callback) => composite?.onPasswordRecovery(callback) ?? (() => {}),
  applySession: async (ownerId, session) => {
    repo.setActiveUserId(ownerId)
    return session ? ownerTransition(await repo.adoptSession(ownerId)) : null
  },
})
