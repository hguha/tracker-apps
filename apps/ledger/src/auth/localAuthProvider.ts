// Device-only auth: no backend, just a session persisted in localStorage so the app
// is fully usable offline (principle #1). When Supabase is configured the composite
// path in AuthContext prefers it; this is the fallback and the "continue on this
// device" option. A local session never syncs (no JWT) — it's a private on-device book.

import type { AuthProvider, Session, SignInResult } from '@tracker-engine/auth'

const SESSION_KEY = 'ledger.session'
export const LOCAL_USER_ID = 'local-user'

function read(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

function write(session: Session | null): void {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  else localStorage.removeItem(SESSION_KEY)
}

export class LocalAuthProvider implements AuthProvider {
  private listeners = new Set<(s: Session | null) => void>()

  private emit(session: Session | null): void {
    write(session)
    for (const cb of this.listeners) cb(session)
  }

  async getSession(): Promise<Session | null> {
    return read()
  }

  onSessionChange(callback: (session: Session | null) => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  async signInWithEmail(): Promise<SignInResult> {
    return { kind: 'error', message: 'Email sign-in needs a backend. Continue on this device instead.' }
  }

  async verifyCode(): Promise<SignInResult> {
    return { kind: 'error', message: 'Email sign-in needs a backend.' }
  }

  // Passwords are a server credential; a device-only book has nothing to check one
  // against, so these are unavailable rather than pretending to protect anything.
  async signUpWithPassword(): Promise<SignInResult> {
    return { kind: 'error', message: 'Creating an account needs a backend.' }
  }

  async signInWithPassword(): Promise<SignInResult> {
    return {
      kind: 'error',
      message: 'Password sign-in needs a backend. Continue on this device instead.',
    }
  }

  async sendPasswordReset(): Promise<SignInResult> {
    return { kind: 'error', message: 'Password resets need a backend.' }
  }

  async resendConfirmation(): Promise<SignInResult> {
    return { kind: 'error', message: 'There is nothing to confirm for a device-only book.' }
  }

  async verifySignupCode(): Promise<SignInResult> {
    return { kind: 'error', message: 'There is nothing to confirm for a device-only book.' }
  }

  async verifyRecoveryCode(): Promise<SignInResult> {
    return { kind: 'error', message: 'A device-only book has no password to reset.' }
  }

  async updatePassword(): Promise<void> {
    throw new Error('A device-only book has no password.')
  }

  async continueOffline(displayName = 'You'): Promise<SignInResult> {
    const session: Session = {
      userId: LOCAL_USER_ID,
      email: '',
      displayName,
      createdAt: Date.now(),
      isVerified: false,
      isLocal: true,
    }
    this.emit(session)
    return { kind: 'session', session }
  }

  async signOut(): Promise<void> {
    this.emit(null)
  }

  async updateDisplayName(name: string): Promise<void> {
    const current = read()
    if (current) this.emit({ ...current, displayName: name.trim() })
  }

  async deleteAccount(): Promise<void> {
    this.emit(null)
  }
}
