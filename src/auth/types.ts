/**
 * The auth boundary (§11.1.1).
 *
 * Everything above this interface — the sign-in screen, the account screen, the
 * greeting, the sign-out guard — is built and exercised against `LocalAuthProvider`
 * so it is real code rather than a stub. Swapping in Supabase in Phase 5 replaces
 * one module and touches nothing else.
 */

export interface Session {
  userId: string
  email: string
  displayName: string
  createdAt: number
  /** False until a magic link or OTP has been confirmed. */
  isVerified: boolean
  /** True for the offline local account, so the UI can label it honestly. */
  isLocal: boolean
}

export type SignInResult =
  | { kind: 'session'; session: Session }
  | { kind: 'code-sent'; email: string }
  | { kind: 'error'; message: string }

export interface AuthProvider {
  getSession(): Promise<Session | null>
  /** Returns an unsubscribe function. */
  onSessionChange(callback: (session: Session | null) => void): () => void

  signInWithEmail(email: string): Promise<SignInResult>
  verifyCode(email: string, code: string): Promise<SignInResult>
  signInWithGoogle(): Promise<SignInResult>
  /** Offline-only path: claims the on-device account with no verification. */
  continueOffline(displayName?: string): Promise<SignInResult>

  signOut(): Promise<void>
  updateDisplayName(name: string): Promise<void>
  deleteAccount(): Promise<void>
}

export function isValidEmail(value: string): boolean {
  // Deliberately permissive: the server is the real authority, and an overly
  // strict client regex rejects addresses that are actually valid.
  const trimmed = value.trim()
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)
}

/** "Harsh Guha" → "HG". Used for the avatar when there's no image. */
export function initialsOf(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase()
}
