// Invariant (§11.1): an offline refresh failure must not sign the user out — supabase-js
// only emits SIGNED_OUT on explicit sign-out or hard token revocation, not a network blip.
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
    // emailRedirectTo must pin to this instance's origin+base (not the dashboard Site URL) and be in the Redirect URLs allowlist.
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
    // Deletion needs the service role, so it runs in an Edge Function (§11.1.2) that cascades to owned rows.
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
