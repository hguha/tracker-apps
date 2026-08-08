/**
 * Auth state for the app (§11.1).
 *
 * One provider instance, one subscription, one place that knows whether someone
 * is signed in. Screens read `useAuth()` and never touch the provider directly,
 * which is what lets the Supabase swap happen in one file.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { LocalAuthProvider } from './localAuthProvider'
import { CompositeAuthProvider } from './compositeAuthProvider'
import { getSupabase } from '@/sync/supabaseClient'
import { setActiveUserId, LOCAL_USER_ID } from '@/db/seed'
import * as repo from '@/data/repository'
import type { AuthProvider, Session, SignInResult } from './types'

interface AuthState {
  /** undefined while the stored session is still being read. */
  session: Session | null | undefined
  isLoading: boolean
  signInWithEmail: (email: string) => Promise<SignInResult>
  verifyCode: (email: string, code: string) => Promise<SignInResult>
  continueOffline: (displayName?: string) => Promise<SignInResult>
  signOut: () => Promise<void>
  updateDisplayName: (name: string) => Promise<void>
  deleteAccount: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

/**
 * With a project configured (Phase 5), a composite provider offers both the
 * Supabase email path and the offline "this device only" path side by side.
 * With no project, the local provider is the whole story. Chosen once, here —
 * no screen knows which it got.
 */
const supabase = getSupabase()
const provider: AuthProvider = supabase
  ? new CompositeAuthProvider(supabase)
  : new LocalAuthProvider()

// When a device-only account signs in for real, claim its on-device data into
// the new uid before the app remounts under it (§11.1.3). Pointing the data
// layer at the new uid first means the re-stamped rows and their outbox entries
// are all owned correctly; the next drain pushes them under the real identity.
if (provider instanceof CompositeAuthProvider) {
  provider.onUpgrade = async (newUserId: string) => {
    setActiveUserId(newUserId)
    const claimed = await repo.claimLocalData(newUserId)
    console.info(`[auth] claimed ${claimed} local rows into ${newUserId}`)
  }
}

export function AuthProviderScope({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false

    // Point the data layer at the current owner *before* the signed-in tree
    // mounts and seeds, so every row is stamped with an id RLS will accept when
    // it syncs. An offline account keeps the local id; a real session uses its
    // UID. Because the tree is keyed on userId (App.tsx), this runs at the
    // signed-out↔signed-in boundary and the app remounts cleanly after it.
    const apply = (next: Session | null) => {
      setActiveUserId(next && !next.isLocal ? next.userId : LOCAL_USER_ID)
      if (!cancelled) setSession(next)
    }

    void provider.getSession().then(apply)
    const unsubscribe = provider.onSessionChange(apply)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const signInWithEmail = useCallback(
    (email: string) => provider.signInWithEmail(email),
    [],
  )
  const verifyCode = useCallback(
    (email: string, code: string) => provider.verifyCode(email, code),
    [],
  )
  const continueOffline = useCallback(
    (displayName?: string) => provider.continueOffline(displayName),
    [],
  )
  const signOut = useCallback(() => provider.signOut(), [])
  const updateDisplayName = useCallback(
    (name: string) => provider.updateDisplayName(name),
    [],
  )
  const deleteAccount = useCallback(() => provider.deleteAccount(), [])

  const value = useMemo<AuthState>(
    () => ({
      session,
      isLoading: session === undefined,
      signInWithEmail,
      verifyCode,
      continueOffline,
      signOut,
      updateDisplayName,
      deleteAccount,
    }),
    [
      session,
      signInWithEmail,
      verifyCode,
      continueOffline,
      signOut,
      updateDisplayName,
      deleteAccount,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside an AuthProviderScope')
  return value
}
