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
import type { AuthProvider, Session, SignInResult } from './types'

interface AuthState {
  /** undefined while the stored session is still being read. */
  session: Session | null | undefined
  isLoading: boolean
  signInWithEmail: (email: string) => Promise<SignInResult>
  verifyCode: (email: string, code: string) => Promise<SignInResult>
  signInWithGoogle: () => Promise<SignInResult>
  continueOffline: (displayName?: string) => Promise<SignInResult>
  signOut: () => Promise<void>
  updateDisplayName: (name: string) => Promise<void>
  deleteAccount: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

/** Swapped for `SupabaseAuthProvider` in Phase 5. Nothing else changes. */
const provider: AuthProvider = new LocalAuthProvider()

export function AuthProviderScope({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    void provider.getSession().then((initial) => {
      if (!cancelled) setSession(initial)
    })
    const unsubscribe = provider.onSessionChange(setSession)
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
  const signInWithGoogle = useCallback(() => provider.signInWithGoogle(), [])
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
      signInWithEmail,
      verifyCode,
      signInWithGoogle,
      continueOffline,
      signOut,
      updateDisplayName,
      deleteAccount,
    }),
    [
      session,
      signInWithEmail,
      verifyCode,
      signInWithGoogle,
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
