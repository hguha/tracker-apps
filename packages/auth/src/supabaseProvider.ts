// Supabase-backed AuthProvider (magic link / OTP verify / delete). Takes the client
// and the native redirect scheme as config so it stays app-agnostic; the app subclasses
// or constructs it with its own scheme.
//
// Invariant: an offline refresh failure must not sign the user out — supabase-js only
// emits SIGNED_OUT on explicit sign-out or hard token revocation, not a network blip.
import type { Session as SupabaseSession, SupabaseClient } from '@supabase/supabase-js'
import { isNativePlatform } from '@tracker-engine/platform'
import type { AuthProvider, Session, SignInResult } from './types'

export interface SupabaseAuthOptions {
  /**
   * Native custom-scheme redirect (e.g. `myapp://auth-callback`), which must be in
   * Supabase's Redirect URL allowlist. On web the current origin + base path is used
   * instead, so previews and the domain both work.
   */
  nativeRedirectUrl: string
}

export class SupabaseAuthProvider implements AuthProvider {
  constructor(
    private client: SupabaseClient,
    private opts: SupabaseAuthOptions,
  ) {}

  private authRedirectUrl(): string {
    if (isNativePlatform()) return this.opts.nativeRedirectUrl
    // Typed loosely so this package compiles without Vite's client types.
    const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'
    return window.location.origin + base
  }

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
    const { error } = await this.client.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: true,
        emailRedirectTo: this.authRedirectUrl(),
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

  /**
   * Creates the account. When the project requires email confirmation (it does —
   * it's what stops scripted signups burning the free tier), there's no session
   * yet, so this returns `confirm-sent` and the caller tells the user to open the
   * link. A project with autoconfirm on returns a session instead, which is passed
   * straight through.
   *
   * Note: Supabase deliberately reports success for an address that already exists,
   * so this can't be used to enumerate accounts.
   */
  async signUpWithPassword(
    email: string,
    password: string,
    displayName?: string,
  ): Promise<SignInResult> {
    const { data, error } = await this.client.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: this.authRedirectUrl(),
        ...(displayName ? { data: { display_name: displayName.trim() } } : {}),
      },
    })
    if (error) return { kind: 'error', message: error.message }
    if (data.session) return { kind: 'session', session: toSession(data.session) }
    return { kind: 'confirm-sent', email: email.trim() }
  }

  async resendConfirmation(email: string): Promise<SignInResult> {
    const { error } = await this.client.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: { emailRedirectTo: this.authRedirectUrl() },
    })
    if (error) return { kind: 'error', message: error.message }
    return { kind: 'confirm-sent', email: email.trim() }
  }

  async signInWithPassword(email: string, password: string): Promise<SignInResult> {
    const { data, error } = await this.client.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (error || !data.session) {
      return { kind: 'error', message: error?.message ?? 'That email and password did not match.' }
    }
    return { kind: 'session', session: toSession(data.session) }
  }

  async sendPasswordReset(email: string): Promise<SignInResult> {
    const { error } = await this.client.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: this.authRedirectUrl(),
    })
    if (error) return { kind: 'error', message: error.message }
    return { kind: 'reset-sent', email: email.trim() }
  }

  async updatePassword(password: string): Promise<void> {
    const { error } = await this.client.auth.updateUser({ password })
    if (error) throw new Error(error.message)
  }

  /**
   * Fires when the user lands from a recovery link, so the app can ask for a new
   * password. Supabase signs them in for that window — the session is real, which
   * is why the app must handle this rather than silently continue.
   */
  onPasswordRecovery(callback: () => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') callback()
    })
    return () => data.subscription.unsubscribe()
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut()
  }

  async updateDisplayName(name: string): Promise<void> {
    await this.client.auth.updateUser({ data: { display_name: name.trim() } })
  }

  async deleteAccount(): Promise<void> {
    // Deletion needs the service role, so it runs in an Edge Function that cascades to owned rows.
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
