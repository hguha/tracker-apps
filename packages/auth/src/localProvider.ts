import type { AuthProvider, Session, SignInResult } from './types'
import { isValidEmail } from './types'

/**
 * A single on-device account with no network and no password.
 *
 * It exists so the whole auth surface is real before any Supabase project is: the screens
 * most likely to break are the ones at the signed-out/signed-in boundary, and stubs don't
 * exercise them. It also simulates the email path end to end — `signInWithEmail` "sends" a
 * code `verifyCode` accepts — so the check-your-email screen and its resend timer are
 * testable without a mail server.
 */

/** Fixed and documented rather than random, so the flow is testable and so nobody mistakes
 *  this for security. The local provider has none, by design. */
export const LOCAL_DEV_CODE = '000000'

/** The owner id every device-only row is stamped with, so an upgrade can find and claim
 *  them. Load-bearing: changing it orphans existing local data. */
export const LOCAL_USER_ID = 'local-user'

export interface LocalAuthConfig {
  /** localStorage key for the session. App-specific and load-bearing — changing it signs
   *  every existing device-only user out. */
  sessionKey: string
  /** Keep the app's own profile row in step with the session's display name. */
  onDisplayName?(userId: string, displayName: string): Promise<void>
  /**
   * Wipe local data when a device-only account is deleted. Leaving rows behind would let
   * the next account read the previous one's, which no server policy can prevent because
   * it never involves the server.
   */
  wipeLocalData?(): Promise<void>
}

interface StoredSession {
  userId: string
  email: string
  displayName: string
  createdAt: number
  isVerified: boolean
}

export class LocalAuthProvider implements AuthProvider {
  private listeners = new Set<(session: Session | null) => void>()
  private pendingEmail: string | null = null

  constructor(private config: LocalAuthConfig) {}

  private read(): StoredSession | null {
    try {
      const raw = localStorage.getItem(this.config.sessionKey)
      return raw ? (JSON.parse(raw) as StoredSession) : null
    } catch {
      // A corrupt entry should log the user out, not crash the app on boot.
      return null
    }
  }

  private write(session: StoredSession | null): void {
    try {
      if (session) localStorage.setItem(this.config.sessionKey, JSON.stringify(session))
      else localStorage.removeItem(this.config.sessionKey)
    } catch {
      // Safari private mode throws on setItem. The in-memory session still works for this
      // tab; failing to persist must not crash sign-in.
    }
  }

  async getSession(): Promise<Session | null> {
    const stored = this.read()
    return stored ? toSession(stored) : null
  }

  onSessionChange(callback: (session: Session | null) => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  private emit(session: Session | null): void {
    for (const listener of this.listeners) listener(session)
  }

  async signInWithEmail(email: string): Promise<SignInResult> {
    if (!isValidEmail(email)) {
      return { kind: 'error', message: 'That doesn’t look like an email address.' }
    }
    this.pendingEmail = email.trim().toLowerCase()
    return { kind: 'code-sent', email: this.pendingEmail }
  }

  async verifyCode(email: string, code: string): Promise<SignInResult> {
    const normalized = email.trim().toLowerCase()
    if (this.pendingEmail !== null && this.pendingEmail !== normalized) {
      return { kind: 'error', message: 'That code was sent to a different address.' }
    }
    if (code.trim() !== LOCAL_DEV_CODE) {
      return { kind: 'error', message: 'That code isn’t right. Try again.' }
    }

    const session = await this.establish(normalized, deriveName(normalized), true)
    this.pendingEmail = null
    return { kind: 'session', session }
  }

  async continueOffline(displayName = 'You'): Promise<SignInResult> {
    const session = await this.establish('local@device', displayName, false)
    return { kind: 'session', session }
  }

  // Passwords are a server credential — there's nothing to check them against on a
  // device-only account, and pretending otherwise would imply protection that isn't there.
  async signUpWithPassword(email: string): Promise<SignInResult> {
    if (!isValidEmail(email)) {
      return { kind: 'error', message: 'That doesn’t look like an email address.' }
    }
    const normalized = email.trim().toLowerCase()
    const session = await this.establish(normalized, deriveName(normalized), true)
    return { kind: 'session', session }
  }

  async signInWithPassword(): Promise<SignInResult> {
    return {
      kind: 'error',
      message: 'Password sign-in needs a connection. Use a code, or continue on this device.',
    }
  }

  async sendPasswordReset(): Promise<SignInResult> {
    return { kind: 'error', message: 'Password resets need a connection.' }
  }

  async resendConfirmation(): Promise<SignInResult> {
    return { kind: 'error', message: 'There is nothing to confirm for a device-only account.' }
  }

  // Without a server there's no address to confirm, so the local dev code stands in.
  verifySignupCode(email: string, code: string): Promise<SignInResult> {
    return this.verifyCode(email, code)
  }

  async verifyRecoveryCode(): Promise<SignInResult> {
    return { kind: 'error', message: 'A device-only account has no password to reset.' }
  }

  async updatePassword(): Promise<void> {
    throw new Error('A device-only account has no password.')
  }

  private async establish(
    email: string,
    displayName: string,
    isVerified: boolean,
  ): Promise<Session> {
    const existing = this.read()
    const stored: StoredSession = {
      // Reuse the existing id when signing back in, so local data is still owned.
      userId: existing?.userId ?? LOCAL_USER_ID,
      email,
      displayName: existing?.displayName ?? displayName,
      createdAt: existing?.createdAt ?? Date.now(),
      isVerified,
    }
    this.write(stored)
    await this.config.onDisplayName?.(stored.userId, stored.displayName)

    const session = toSession(stored)
    this.emit(session)
    return session
  }

  async signOut(): Promise<void> {
    this.write(null)
    this.pendingEmail = null
    this.emit(null)
  }

  async updateDisplayName(name: string): Promise<void> {
    const stored = this.read()
    if (!stored) return
    const trimmed = name.trim()
    if (!trimmed) return

    const next = { ...stored, displayName: trimmed }
    this.write(next)
    await this.config.onDisplayName?.(stored.userId, trimmed)
    this.emit(toSession(next))
  }

  async deleteAccount(): Promise<void> {
    this.write(null)
    this.pendingEmail = null
    await this.config.wipeLocalData?.()
    this.emit(null)
  }
}

function toSession(stored: StoredSession): Session {
  return { ...stored, isLocal: true }
}

/** `harsh.guha@example.com` → `Harsh Guha`. A starting point, always editable. */
export function deriveName(email: string): string {
  const local = email.split('@')[0] ?? ''
  const words = local
    .replace(/[._-]+/g, ' ')
    .replace(/\d+/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return 'You'
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}
