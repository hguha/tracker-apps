/**
 * Runs the online (Supabase) and offline (local) auth paths side by side.
 *
 * The app can't just pick one provider at boot: a user with a real project
 * attached should still be able to choose "use this device only" and keep
 * everything in the browser. So this composes both and routes by intent —
 * email sign-in goes to Supabase, "continue offline" goes to the local
 * provider — while presenting one `AuthProvider` to the rest of the app.
 *
 * A local offline session wins over a remote one, because choosing "this device
 * only" is an explicit decision to stay off the network. Sync is gated on
 * `session.isLocal` (see useSync), so an offline account never pushes to a
 * server it isn't authenticated against.
 *
 * Both underlying subscriptions are wired once, in the constructor, for the
 * provider's lifetime (it's a module singleton). An earlier version wired them
 * lazily inside `onSessionChange` behind a flag, which dropped the SIGNED_IN
 * event under React StrictMode's mount/unmount/mount — the magic-link redirect
 * would resolve a session that never reached React, leaving the sign-in screen
 * up. Subscribing in the constructor removes that failure entirely.
 */

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

  constructor(client: SupabaseClient) {
    this.remote = new SupabaseAuthProvider(client)

    // Wire both sources for good, right now. Any change to either recomputes the
    // effective session and notifies every current listener — so a login event
    // that arrives after the component subscribed still propagates.
    this.local.onSessionChange((session) => {
      this.localSession = session
      this.emit()
    })
    this.remote.onSessionChange((session) => {
      this.remoteSession = session
      this.emit()
    })
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
  deleteAccount(): Promise<void> {
    return this.localSession ? this.local.deleteAccount() : this.remote.deleteAccount()
  }
}
