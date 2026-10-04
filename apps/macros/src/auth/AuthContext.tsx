import { createAuthScope } from '@tracker-engine/auth/react'
import { CompositeAuthProvider, LOCAL_USER_ID, type AuthProvider } from '@tracker-engine/auth'
import { getSupabase } from '@/backend/supabaseClient'
import * as repo from '@/data/repository'
import { LocalAuthProvider } from './localAuthProvider'
import { MacrosAuthProvider } from './supabaseAuthProvider'

/** What signing in did to this device's data, so the app can say so once. */
type DataTransition = { kind: 'claimed'; rows: number } | { kind: 'wiped-foreign' }

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

// Claim on upgrade runs before the remote session reaches React, so a device-only user's food
// log moves onto the account rather than being wiped by the owner guard.
if (composite) {
  composite.onUpgrade = async (newUserId) => {
    repo.setActiveUserId(newUserId)
    const claimed = await repo.claimLocalData(newUserId)
    repo.setDbOwner(newUserId)
    if (claimed > 0) console.info(`[auth] claimed ${claimed} local rows into ${newUserId}`)
  }
}

export const { AuthProviderScope, useAuth } = createAuthScope<DataTransition>({
  provider,
  isLocalOnly: supabase === null,
  localUserId: LOCAL_USER_ID,
  onPasswordRecovery: (callback) => composite?.onPasswordRecovery(callback) ?? (() => {}),
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
