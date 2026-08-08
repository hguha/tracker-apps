/**
 * Runs the online (Supabase) and offline (local) auth paths side by side.
 *
 * The app can't just pick one provider at boot: a user with a real project
 * attached should still be able to choose "use this device only" and keep
 * everything in the browser. So this composes both and routes by intent —
 * email sign-in goes to Supabase, "continue offline" goes to the local
 * provider — while presenting one `AuthProvider` to the rest of the app.
 *
 * A local offline session normally wins over a remote one, because choosing
 * "this device only" is an explicit decision to stay off the network. Sync is
 * gated on `session.isLocal` (see useSync), so an offline account never pushes
 * to a server it isn't authenticated against.
 *
 * The exception is the **upgrade**: a device-only user who then signs in with
 * email is claiming their account. When a remote session arrives while a local
 * one is active, we hand the local data to the new uid (`onUpgrade`), drop the
 * local session, and let the remote session take over — so their history syncs
 * up under the real account instead of being stranded. This is the only moment
 * the local session yields to the remote one.
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
  /** Guards against re-entrant upgrades while one is already in flight. */
  private upgrading = false

  /**
   * Called when a device-only session is upgraded to a real account, with the
   * new uid, *before* the remote session is surfaced. Wired by AuthContext to
   * claim the local data into the account. Awaited, so the claim completes
   * before the app remounts under the new uid.
   */
  onUpgrade: ((newUserId: string) => Promise<void>) | null = null

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
      void this.handleRemoteChange()
    })
  }

  /**
   * A remote session arriving while a local one is active is an upgrade: claim
   * the on-device data into the new account, then drop the local session so the
   * remote one becomes effective. Everything else just re-emits.
   */
  private async handleRemoteChange(): Promise<void> {
    const isUpgrade =
      this.remoteSession !== null && this.localSession !== null && !this.upgrading

    if (isUpgrade) {
      this.upgrading = true
      try {
        await this.onUpgrade?.(this.remoteSession!.userId)
      } catch (error) {
        // A failed claim must not strand the user signed-out. Log and continue;
        // the remote session still takes over, and a manual sync can retry.
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
