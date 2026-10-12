import { createAuthScope } from '@tracker-engine/auth/react'
import { ownerTransition, type OwnerTransition } from '@tracker-engine/local-first'
import { LocalAuthProvider } from './localAuthProvider'
import { CompositeAuthProvider } from './compositeAuthProvider'
import { getSupabase } from '@/backend/supabaseClient'
import { setActiveUserId, LOCAL_USER_ID } from '@/db/seed'
import * as repo from '@/data/repository'
import type { AuthProvider } from './types'

const supabase = getSupabase()
const composite = supabase ? new CompositeAuthProvider(supabase) : null
const provider: AuthProvider = composite ?? new LocalAuthProvider()

export const { AuthProviderScope, useAuth } = createAuthScope<OwnerTransition>({
  provider,
  isLocalOnly: supabase === null,
  localUserId: LOCAL_USER_ID,
  onPasswordRecovery: (callback) => composite?.onPasswordRecovery(callback) ?? (() => {}),
  applySession: async (ownerId, session) => {
    setActiveUserId(ownerId)
    return session ? ownerTransition(await repo.adoptSession(ownerId)) : null
  },
})
