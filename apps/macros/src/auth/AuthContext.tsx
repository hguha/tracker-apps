import { createAuthScope } from '@tracker-engine/auth/react'
import { LOCAL_USER_ID, type AuthProvider } from '@tracker-engine/auth'
import { getSupabase } from '@/backend/supabaseClient'
import * as repo from '@/data/repository'
import { LocalAuthProvider } from './localAuthProvider'
import { MacrosAuthProvider } from './supabaseAuthProvider'

/** What signing in did to this device's data, so the app can say so once. */
export type DataTransition = { kind: 'claimed'; rows: number } | { kind: 'wiped-foreign' }

const supabase = getSupabase()
const provider: AuthProvider = supabase
  ? new MacrosAuthProvider(supabase)
  : new LocalAuthProvider()

export const { AuthProviderScope, useAuth } = createAuthScope<DataTransition>({
  provider,
  isLocalOnly: supabase === null,
  localUserId: LOCAL_USER_ID,
  applySession: async (ownerId, session) => {
    repo.setActiveUserId(ownerId)
    if (!session) return null

    // Claim before the guard runs: it wipes rows owned by a different account, which would
    // otherwise include the ones just re-owned. That order is the whole correctness argument.
    const claimed = await repo.claimLocalData(ownerId)
    repo.setDbOwner(ownerId)
    const wiped = await repo.assertDbOwner(ownerId)

    if (wiped) return { kind: 'wiped-foreign' }
    return claimed > 0 ? { kind: 'claimed', rows: claimed } : null
  },
})
