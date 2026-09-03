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
  /** A reset email is on its way; there's no session yet. */
  | { kind: 'reset-sent'; email: string }
  /**
   * Sign-up succeeded but the address must be confirmed before the account works.
   * Distinct from `code-sent` because the user's next action is different: open the
   * link in the email, not type a code.
   */
  | { kind: 'confirm-sent'; email: string }
  | { kind: 'error'; message: string }

export interface AuthProvider {
  getSession(): Promise<Session | null>
  /** Returns an unsubscribe function. */
  onSessionChange(callback: (session: Session | null) => void): () => void

  signInWithEmail(email: string): Promise<SignInResult>
  verifyCode(email: string, code: string): Promise<SignInResult>
  /** Offline-only path: claims the on-device account with no verification. */
  continueOffline(displayName?: string): Promise<SignInResult>

  // ── Password credentials ───────────────────────────────────────────────────
  // A password is the second way into the same account, so a user who can't
  // receive email (or a store reviewer) isn't locked out. Sign-up returns a
  // session immediately — no "confirm your email, now sign in again" round trip.
  signUpWithPassword(
    email: string,
    password: string,
    displayName?: string,
  ): Promise<SignInResult>
  signInWithPassword(email: string, password: string): Promise<SignInResult>
  /** Emails a recovery link; completing it lands the app in recovery mode. */
  sendPasswordReset(email: string): Promise<SignInResult>
  /** Re-sends the sign-up confirmation email, for when the first one is lost. */
  resendConfirmation(email: string): Promise<SignInResult>
  /**
   * Confirms a new account with the code from the sign-up email, instead of the
   * link. A code has no redirect URL to get wrong, so it behaves the same on the
   * web, an installed PWA, and inside the native shell — and it still works when
   * the email is opened on a different device.
   */
  verifySignupCode(email: string, code: string): Promise<SignInResult>
  /** Sets (or replaces) the password for the signed-in user. */
  updatePassword(password: string): Promise<void>

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

// Supabase's default minimum. Kept here so the client can say what's wrong before
// a round trip, and so every app enforces the same floor.
export const PASSWORD_MIN_LENGTH = 6

/** null when acceptable, else the reason to show the user. */
export function passwordProblem(value: string): string | null {
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`
  }
  return null
}

export function isValidPassword(value: string): boolean {
  return passwordProblem(value) === null
}

export function initialsOf(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase()
}
