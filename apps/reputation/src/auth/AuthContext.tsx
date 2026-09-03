// Auth state for the app (§11.1): one provider, read via `useAuth()`, never touched directly.

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
import { getSupabase } from '@/backend/supabaseClient'
import { setActiveUserId, LOCAL_USER_ID } from '@/db/seed'
import { setDbOwner } from '@/db/owner'
import * as repo from '@/data/repository'
import type { AuthProvider, Session, SignInResult } from './types'

interface AuthState {
  /** undefined while the stored session is still being read. */
  session: Session | null | undefined
  isLoading: boolean
  signInWithEmail: (email: string) => Promise<SignInResult>
  verifyCode: (email: string, code: string) => Promise<SignInResult>
  continueOffline: (displayName?: string) => Promise<SignInResult>
  signUpWithPassword: (
    email: string,
    password: string,
    displayName?: string,
  ) => Promise<SignInResult>
  signInWithPassword: (email: string, password: string) => Promise<SignInResult>
  sendPasswordReset: (email: string) => Promise<SignInResult>
  updatePassword: (password: string) => Promise<void>
  /** True after landing from a recovery link, until a new password is set. */
  isRecoveringPassword: boolean
  clearPasswordRecovery: () => void
  signOut: () => Promise<void>
  updateDisplayName: (name: string) => Promise<void>
  deleteAccount: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

// Composite provider when a project is configured, else the local provider; chosen once here.
const supabase = getSupabase()
const provider: AuthProvider = supabase
  ? new CompositeAuthProvider(supabase)
  : new LocalAuthProvider()

// On upgrade, point the data layer at the new uid and claim on-device data before remount (§11.1.3).
if (provider instanceof CompositeAuthProvider) {
  provider.onUpgrade = async (newUserId: string) => {
    setActiveUserId(newUserId)
    const claimed = await repo.claimLocalData(newUserId)
    // Record ownership before `apply`'s guard runs, so these just-claimed rows aren't wiped as another account's.
    setDbOwner(newUserId)
    console.info(`[auth] claimed ${claimed} local rows into ${newUserId}`)
  }
}

export function AuthProviderScope({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [isRecoveringPassword, setIsRecoveringPassword] = useState(false)

  // A recovery link signs the user in, so without this the app would just open as
  // normal and the "reset my password" intent would be silently lost.
  useEffect(() => {
    if (!(provider instanceof CompositeAuthProvider)) return
    return provider.onPasswordRecovery(() => setIsRecoveringPassword(true))
  }, [])

  useEffect(() => {
    let cancelled = false

    // Point the data layer at the owner and run the ownership guard *before* the session
    // reaches React: a mounted screen reads whole IndexedDB tables, so a leftover account's
    // rows would already be on screen (§11.1.3).
    const apply = async (next: Session | null) => {
      const ownerId = next && !next.isLocal ? next.userId : LOCAL_USER_ID
      setActiveUserId(ownerId)
      if (next) {
        const wiped = await repo.assertDbOwner(ownerId)
        if (wiped) console.info(`[auth] wiped another account's local data`)
      }
      if (!cancelled) setSession(next)
    }

    void provider.getSession().then(apply)
    const unsubscribe = provider.onSessionChange((next) => void apply(next))
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
  const signUpWithPassword = useCallback(
    (email: string, password: string, displayName?: string) =>
      provider.signUpWithPassword(email, password, displayName),
    [],
  )
  const signInWithPassword = useCallback(
    (email: string, password: string) => provider.signInWithPassword(email, password),
    [],
  )
  const sendPasswordReset = useCallback(
    (email: string) => provider.sendPasswordReset(email),
    [],
  )
  const updatePassword = useCallback(
    (password: string) => provider.updatePassword(password),
    [],
  )
  const clearPasswordRecovery = useCallback(() => setIsRecoveringPassword(false), [])
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
      signUpWithPassword,
      signInWithPassword,
      sendPasswordReset,
      updatePassword,
      isRecoveringPassword,
      clearPasswordRecovery,
      signOut,
      updateDisplayName,
      deleteAccount,
    }),
    [
      session,
      signInWithEmail,
      verifyCode,
      continueOffline,
      signUpWithPassword,
      signInWithPassword,
      sendPasswordReset,
      updatePassword,
      isRecoveringPassword,
      clearPasswordRecovery,
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
