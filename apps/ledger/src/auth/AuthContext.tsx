// Auth state for the app: one provider, read via `useAuth()`, never touched directly.
// Supabase-backed when a project is configured, else the local device provider —
// chosen once. On sign-in the DB owner guard runs before the session reaches React,
// so a screen never renders another account's data (principle #5).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { AuthProvider, Session, SignInResult } from '@tracker-engine/auth'
import { getSupabase } from '@/backend/supabaseClient'
import { assertDbOwner } from '@/db'
import { LedgerAuthProvider } from './supabaseAuthProvider'
import { LocalAuthProvider, LOCAL_USER_ID } from './localAuthProvider'

interface AuthState {
  /** undefined while the stored session is still being read. */
  session: Session | null | undefined
  isLoading: boolean
  /** True when there's no backend — the sign-in screen offers "continue on device". */
  isLocalOnly: boolean
  signInWithEmail: (email: string) => Promise<SignInResult>
  verifyCode: (email: string, code: string) => Promise<SignInResult>
  continueOffline: (displayName?: string) => Promise<SignInResult>
  signOut: () => Promise<void>
  updateDisplayName: (name: string) => Promise<void>
  deleteAccount: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

const supabase = getSupabase()
const provider: AuthProvider = supabase
  ? new LedgerAuthProvider(supabase)
  : new LocalAuthProvider()
const isLocalOnly = supabase === null

export function AuthProviderScope({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false

    // Run the ownership guard before the session reaches React: a mounted screen
    // reads whole IndexedDB tables, so a leftover account's rows would already be on
    // screen otherwise.
    const apply = async (next: Session | null) => {
      const ownerId = next && !next.isLocal ? next.userId : LOCAL_USER_ID
      if (next) await assertDbOwner(ownerId)
      if (!cancelled) setSession(next)
    }

    void provider.getSession().then(apply)
    const unsubscribe = provider.onSessionChange((next) => void apply(next))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const signInWithEmail = useCallback((email: string) => provider.signInWithEmail(email), [])
  const verifyCode = useCallback(
    (email: string, code: string) => provider.verifyCode(email, code),
    [],
  )
  const continueOffline = useCallback(
    (displayName?: string) => provider.continueOffline(displayName),
    [],
  )
  const signOut = useCallback(() => provider.signOut(), [])
  const updateDisplayName = useCallback((name: string) => provider.updateDisplayName(name), [])
  const deleteAccount = useCallback(() => provider.deleteAccount(), [])

  const value = useMemo<AuthState>(
    () => ({
      session,
      isLoading: session === undefined,
      isLocalOnly,
      signInWithEmail,
      verifyCode,
      continueOffline,
      signOut,
      updateDisplayName,
      deleteAccount,
    }),
    [session, signInWithEmail, verifyCode, continueOffline, signOut, updateDisplayName, deleteAccount],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside an AuthProviderScope')
  return value
}

export { LOCAL_USER_ID }
