/**
 * The offline auth provider (§11.1.1).
 *
 * A single on-device account with no network and no password. It exists so the
 * whole auth surface is real before any Supabase project does — the screens most
 * likely to break are the ones at the signed-out/signed-in boundary, and stubs
 * don't exercise them.
 *
 * It also simulates the email path end to end: `signInWithEmail` "sends" a code
 * that `verifyCode` accepts, so the check-your-email screen and its resend timer
 * are testable without a mail server.
 */

import { db } from '@/db/database'
import { clearDbOwner } from '@/db/owner'
import type { AuthProvider, Session, SignInResult } from './types'
import { isValidEmail } from './types'

const SESSION_KEY = 'workout-tracker.session'

/**
 * The code the simulated email path accepts. Fixed and documented rather than
 * random, so the flow is testable and so nobody mistakes this for security — the
 * local provider has none, by design.
 */
export const LOCAL_DEV_CODE = '000000'

interface StoredSession {
  userId: string
  email: string
  displayName: string
  createdAt: number
  isVerified: boolean
}

function read(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as StoredSession) : null
  } catch {
    // A corrupt entry should log the user out, not crash the app on boot.
    return null
  }
}

function write(session: StoredSession | null): void {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  else localStorage.removeItem(SESSION_KEY)
}

function toSession(stored: StoredSession): Session {
  return { ...stored, isLocal: true }
}

export class LocalAuthProvider implements AuthProvider {
  private listeners = new Set<(session: Session | null) => void>()
  private pendingEmail: string | null = null

  async getSession(): Promise<Session | null> {
    const stored = read()
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

  private async establish(
    email: string,
    displayName: string,
    isVerified: boolean,
  ): Promise<Session> {
    const existing = read()
    const stored: StoredSession = {
      // Reuse the existing id when signing back in, so local data is still owned.
      userId: existing?.userId ?? 'local-user',
      email,
      displayName: existing?.displayName ?? displayName,
      createdAt: existing?.createdAt ?? Date.now(),
      isVerified,
    }
    write(stored)
    await this.syncProfileRow(stored)

    const session = toSession(stored)
    this.emit(session)
    return session
  }

  /** Keeps the profile row's name in step with the session. */
  private async syncProfileRow(stored: StoredSession): Promise<void> {
    const profile = await db.profiles.get(stored.userId)
    if (profile) {
      if (profile.displayName !== stored.displayName) {
        await db.profiles.update(stored.userId, {
          displayName: stored.displayName,
          updatedAt: Date.now(),
          clientRev: profile.clientRev + 1,
        })
      }
      return
    }
  }

  async signOut(): Promise<void> {
    write(null)
    this.pendingEmail = null
    this.emit(null)
  }

  async updateDisplayName(name: string): Promise<void> {
    const stored = read()
    if (!stored) return
    const trimmed = name.trim()
    if (!trimmed) return

    const next = { ...stored, displayName: trimmed }
    write(next)

    const profile = await db.profiles.get(stored.userId)
    if (profile) {
      await db.profiles.update(stored.userId, {
        displayName: trimmed,
        updatedAt: Date.now(),
        clientRev: profile.clientRev + 1,
      })
    }
    this.emit(toSession(next))
  }

  /**
   * Wipes the local database along with the session.
   *
   * The wipe is the point: leaving rows behind would let the next account read
   * the previous one's cached data, which no server policy can prevent because it
   * never involves the server (§11.1.3).
   */
  async deleteAccount(): Promise<void> {
    write(null)
    this.pendingEmail = null
    await db.delete()
    await db.open()
    // The database is gone, so the ownership marker must go with it — a stale
    // marker would make the next sign-in look like a foreign account.
    clearDbOwner()
    this.emit(null)
  }
}

/** `harsh.guha@example.com` → `Harsh Guha`. A starting point, always editable. */
function deriveName(email: string): string {
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

export { deriveName }
