export interface Session {
  userId: string
  email: string
  displayName: string
  createdAt: number
  isVerified: boolean
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
  /** Offline-only path: claims the on-device account with no verification. */
  continueOffline(displayName?: string): Promise<SignInResult>

  signOut(): Promise<void>
  updateDisplayName(name: string): Promise<void>
  deleteAccount(): Promise<void>
}

export function isValidEmail(value: string): boolean {
  // Deliberately permissive: the server is the real authority on validity.
  const trimmed = value.trim()
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)
}

// Token length is a server setting (Supabase mailer_otp_length, 6–10), so accept a range.
export const CODE_MIN_LENGTH = 6
export const CODE_MAX_LENGTH = 10

// Permissive; the server validates correctness. Tokens aren't guaranteed numeric.
export function isSubmittableCode(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length >= CODE_MIN_LENGTH && trimmed.length <= CODE_MAX_LENGTH
}

export function initialsOf(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase()
}
