// Composes the online (Supabase) and offline (local) auth paths, routing by intent.
// The local session wins except on upgrade: when a remote session arrives while a local
// one is active, claim the local data into the new uid and yield to the remote session.
// Subscriptions are wired in the constructor so a late SIGNED_IN (magic-link redirect) still propagates.

import type { SupabaseClient } from '@supabase/supabase-js'
import { LocalAuthProvider } from './localAuthProvider'
import { SupabaseAuthProvider } from './supabaseAuthProvider'
import type { AuthProvider, Session, SignInResult } from './types'

export class CompositeAuthProvider implements AuthProvider {
  private local = new LocalAuthProvider()
  private remote: SupabaseAuthProvider

  private listeners = new Set<(session: Session | null) => void>()
  private localSession: Session | null = null
  private remoteSession: Session | null = null
  /** Guards against re-entrant upgrades while one is already in flight. */
  private upgrading = false

  // Awaited before the remote session is surfaced, so the claim completes before the app remounts.
  onUpgrade: ((newUserId: string) => Promise<void>) | null = null

  constructor(client: SupabaseClient) {
    this.remote = new SupabaseAuthProvider(client)

    this.local.onSessionChange((session) => {
      this.localSession = session
      this.emit()
    })
    this.remote.onSessionChange((session) => {
      this.remoteSession = session
      void this.handleRemoteChange()
    })
  }

  // A remote session arriving while a local one is active is an upgrade; everything else re-emits.
  private async handleRemoteChange(): Promise<void> {
    const isUpgrade =
      this.remoteSession !== null && this.localSession !== null && !this.upgrading

    if (isUpgrade) {
      this.upgrading = true
      try {
        await this.onUpgrade?.(this.remoteSession!.userId)
      } catch (error) {
        // A failed claim must not strand the user signed-out; the remote session still takes over.
        console.error('[auth] account upgrade claim failed', error)
      } finally {
        // Drop the local session so the remote one wins from here on.
        await this.local.signOut()
        this.localSession = null
        this.upgrading = false
      }
    }
    this.emit()
  }

  async getSession(): Promise<Session | null> {
    this.localSession = await this.local.getSession()
    this.remoteSession = await this.remote.getSession()
    return this.effective()
  }

  onSessionChange(callback: (session: Session | null) => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  private effective(): Session | null {
    return this.localSession ?? this.remoteSession
  }

  private emit(): void {
    const session = this.effective()
    for (const listener of this.listeners) listener(session)
  }

  // Online paths → Supabase.
  signInWithEmail(email: string): Promise<SignInResult> {
    return this.remote.signInWithEmail(email)
  }
  verifyCode(email: string, code: string): Promise<SignInResult> {
    return this.remote.verifyCode(email, code)
  }

  signUpWithPassword(
    email: string,
    password: string,
    displayName?: string,
  ): Promise<SignInResult> {
    return this.remote.signUpWithPassword(email, password, displayName)
  }
  signInWithPassword(email: string, password: string): Promise<SignInResult> {
    return this.remote.signInWithPassword(email, password)
  }
  sendPasswordReset(email: string): Promise<SignInResult> {
    return this.remote.sendPasswordReset(email)
  }
  resendConfirmation(email: string): Promise<SignInResult> {
    return this.remote.resendConfirmation(email)
  }
  verifySignupCode(email: string, code: string): Promise<SignInResult> {
    return this.remote.verifySignupCode(email, code)
  }
  verifyRecoveryCode(email: string, code: string): Promise<SignInResult> {
    return this.remote.verifyRecoveryCode(email, code)
  }
  /** Recovery only exists for the remote account. */
  onPasswordRecovery(callback: () => void): () => void {
    return this.remote.onPasswordRecovery(callback)
  }

  // Offline path → local, always available even with a backend configured.
  continueOffline(displayName?: string): Promise<SignInResult> {
    return this.local.continueOffline(displayName)
  }

  // Mutations route to whichever session is currently active.
  async signOut(): Promise<void> {
    if (this.localSession) return this.local.signOut()
    return this.remote.signOut()
  }
  updateDisplayName(name: string): Promise<void> {
    return this.localSession
      ? this.local.updateDisplayName(name)
      : this.remote.updateDisplayName(name)
  }
  updatePassword(password: string): Promise<void> {
    return this.localSession
      ? this.local.updatePassword()
      : this.remote.updatePassword(password)
  }
  deleteAccount(): Promise<void> {
    return this.localSession ? this.local.deleteAccount() : this.remote.deleteAccount()
  }
}
