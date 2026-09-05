import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { AuthProvider, Session, SignInResult } from '../types'
import { LOCAL_USER_ID } from '../localProvider'

export interface AuthState<T> {
  /** undefined while the stored session is still being read. */
  session: Session | null | undefined
  isLoading: boolean
  /** True when there's no backend, so the sign-in screen offers device-only. */
  isLocalOnly: boolean
  signInWithEmail: (email: string) => Promise<SignInResult>
  verifyCode: (email: string, code: string) => Promise<SignInResult>
  continueOffline: (displayName?: string) => Promise<SignInResult>
  signUpWithPassword: (email: string, password: string) => Promise<SignInResult>
  signInWithPassword: (email: string, password: string) => Promise<SignInResult>
  sendPasswordReset: (email: string) => Promise<SignInResult>
  resendConfirmation: (email: string) => Promise<SignInResult>
  verifySignupCode: (email: string, code: string) => Promise<SignInResult>
  verifyRecoveryCode: (email: string, code: string) => Promise<SignInResult>
  updatePassword: (password: string) => Promise<void>
  /** True from arriving on a reset code until the new password is set. */
  isRecoveringPassword: boolean
  beginPasswordRecovery: () => void
  clearPasswordRecovery: () => void
  signOut: () => Promise<void>
  updateDisplayName: (name: string) => Promise<void>
  deleteAccount: () => Promise<void>
  /** Whatever `applySession` reported about this device's data, for the app to surface once. */
  transition: T | null
  clearTransition: () => void
}

export interface AuthScopeConfig<T> {
  provider: AuthProvider
  isLocalOnly: boolean
  localUserId?: string
  /**
   * Subscribes to the backend's password-recovery event. Redeeming a reset code signs the
   * user in, so without this the app would just open as normal and the "reset my password"
   * intent would be silently lost.
   */
  onPasswordRecovery?(callback: () => void): () => void
  /**
   * Runs with the resolved owner id *before* the session reaches React. A mounted screen
   * reads whole IndexedDB tables, so anything that has to happen before the first render —
   * pointing the data layer at the owner, claiming or wiping local rows — belongs here, not
   * in an effect. Return a value to surface it once via `transition`.
   */
  applySession?(ownerId: string, session: Session | null): Promise<T | null>
}

export function createAuthScope<T>(config: AuthScopeConfig<T>) {
  const { provider, isLocalOnly } = config
  const localUserId = config.localUserId ?? LOCAL_USER_ID
  const Context = createContext<AuthState<T> | null>(null)

  function AuthProviderScope({ children }: { children: ReactNode }) {
    const [session, setSession] = useState<Session | null | undefined>(undefined)
    const [transition, setTransition] = useState<T | null>(null)
    const [isRecoveringPassword, setIsRecoveringPassword] = useState(false)

    useEffect(() => config.onPasswordRecovery?.(() => setIsRecoveringPassword(true)), [])

    useEffect(() => {
      let cancelled = false

      const apply = async (next: Session | null) => {
        const ownerId = next && !next.isLocal ? next.userId : localUserId
        const result = (await config.applySession?.(ownerId, next)) ?? null
        if (cancelled) return
        setSession(next)
        if (result !== null) setTransition(result)
      }

      void provider.getSession().then(apply)
      const unsubscribe = provider.onSessionChange((next) => void apply(next))
      return () => {
        cancelled = true
        unsubscribe()
      }
    }, [])

    const bind = useCallback(
      <A extends unknown[], R>(fn: (...args: A) => R) =>
        (...args: A): R =>
          fn.apply(provider, args),
      [],
    )

    const value = useMemo<AuthState<T>>(
      () => ({
        session,
        isLoading: session === undefined,
        isLocalOnly,
        signInWithEmail: bind(provider.signInWithEmail),
        verifyCode: bind(provider.verifyCode),
        continueOffline: bind(provider.continueOffline),
        signUpWithPassword: bind(provider.signUpWithPassword),
        signInWithPassword: bind(provider.signInWithPassword),
        sendPasswordReset: bind(provider.sendPasswordReset),
        resendConfirmation: bind(provider.resendConfirmation),
        verifySignupCode: bind(provider.verifySignupCode),
        verifyRecoveryCode: bind(provider.verifyRecoveryCode),
        updatePassword: bind(provider.updatePassword),
        isRecoveringPassword,
        beginPasswordRecovery: () => setIsRecoveringPassword(true),
        clearPasswordRecovery: () => setIsRecoveringPassword(false),
        signOut: bind(provider.signOut),
        updateDisplayName: bind(provider.updateDisplayName),
        deleteAccount: bind(provider.deleteAccount),
        transition,
        clearTransition: () => setTransition(null),
      }),
      [session, transition, isRecoveringPassword, bind],
    )

    return <Context.Provider value={value}>{children}</Context.Provider>
  }

  function useAuth(): AuthState<T> {
    const value = useContext(Context)
    if (!value) throw new Error('useAuth must be used inside an AuthProviderScope')
    return value
  }

  return { AuthProviderScope, useAuth }
}
