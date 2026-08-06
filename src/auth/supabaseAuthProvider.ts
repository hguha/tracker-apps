/**
 * The Supabase auth provider (§11.1.1, Phase 5).
 *
 * Implements the same `AuthProvider` interface as `LocalAuthProvider`, so the
 * swap is this file plus one line in AuthContext — no screen changes. Magic-link
 * email is primary, Google OAuth secondary, both per §11.1.
 *
 * The load-bearing rule (§11.1): a refresh failure while offline must not sign
 * the user out. supabase-js keeps the session in storage and only emits
 * `SIGNED_OUT` on an explicit sign-out or a hard token revocation, so a network
 * blip surfaces as a failed request the sync engine retries — not a logout.
 */

import type { Session as SupabaseSession, SupabaseClient } from '@supabase/supabase-js'
import type { AuthProvider, Session, SignInResult } from './types'

export class SupabaseAuthProvider implements AuthProvider {
  constructor(private client: SupabaseClient) {}

  async getSession(): Promise<Session | null> {
    const { data } = await this.client.auth.getSession()
    return data.session ? toSession(data.session) : null
  }

  onSessionChange(callback: (session: Session | null) => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      callback(session ? toSession(session) : null)
    })
    return () => data.subscription.unsubscribe()
  }

  async signInWithEmail(email: string): Promise<SignInResult> {
    // Magic link + OTP. The link must redirect back to *this* running instance,
    // base path included, or clicking it opens a URL where the app isn't and the
    // token never reaches the tab that asked for it (the "stays on the sign-in
    // screen" symptom). Falling back to the dashboard Site URL is exactly what
    // goes wrong across dev/preview/prod, so pin it to the current origin.
    // This URL must also be in the dashboard's Redirect URLs allowlist.
    const { error } = await this.client.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: true,
        emailRedirectTo: window.location.origin + import.meta.env.BASE_URL,
      },
    })
    if (error) return { kind: 'error', message: error.message }
    return { kind: 'code-sent', email: email.trim() }
  }

  async verifyCode(email: string, code: string): Promise<SignInResult> {
    const { data, error } = await this.client.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    })
    if (error || !data.session) {
      return { kind: 'error', message: error?.message ?? 'That code did not work.' }
    }
    return { kind: 'session', session: toSession(data.session) }
  }

  async continueOffline(): Promise<SignInResult> {
    // Not meaningful against a real backend — the local provider owns this path.
    return { kind: 'error', message: 'Offline accounts are only available locally.' }
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut()
  }

  async updateDisplayName(name: string): Promise<void> {
    await this.client.auth.updateUser({ data: { display_name: name.trim() } })
  }

  async deleteAccount(): Promise<void> {
    // Account deletion needs the service role, so it runs in an Edge Function
    // (§11.1.2) invoked here; the function verifies the caller's JWT and deletes
    // their auth user, which cascades to every owned row.
    const { error } = await this.client.functions.invoke('delete-account')
    if (error) throw new Error(error.message)
    await this.client.auth.signOut()
  }
}

function toSession(session: SupabaseSession): Session {
  const user = session.user
  return {
    userId: user.id,
    email: user.email ?? '',
    displayName:
      (user.user_metadata?.display_name as string | undefined) ??
      user.email?.split('@')[0] ??
      '',
    createdAt: user.created_at ? new Date(user.created_at).getTime() : Date.now(),
    // A Supabase session only exists post-verification, so it's always verified.
    isVerified: true,
    isLocal: false,
  }
}
