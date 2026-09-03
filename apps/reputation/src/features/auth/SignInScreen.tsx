import { useEffect, useState } from 'react'
import { ArrowLeft, Dumbbell, KeyRound, Mail, WifiOff } from 'lucide-react'
import { Button } from '@/components/Button'
import { useAuth } from '@/auth/AuthContext'
import {
  CODE_MAX_LENGTH,
  isSubmittableCode,
  isValidEmail,
  passwordProblem,
} from '@/auth/types'
import { LOCAL_DEV_CODE } from '@/auth/localAuthProvider'
import { isBackendConfigured } from '@/backend/supabaseClient'
import { cn } from '@/lib/cn'

const RESEND_SECONDS = 30

// With a real backend, the dev-code note and offline path are hidden.
const HAS_BACKEND = isBackendConfigured()

/**
 * Panels, not steps: password is the default way in and creating an account signs
 * you straight in (no "confirm your email, now sign in again" detour). The emailed
 * code remains as an alternative for anyone who'd rather not keep a password.
 */
type Panel = 'password' | 'signup' | 'code' | 'forgot'

export function SignInScreen({
  // Present in "connect account" mode: a device-only user upgrading to a real account.
  onCancel,
}: {
  onCancel?: () => void
} = {}) {
  const {
    signInWithEmail,
    verifyCode,
    continueOffline,
    signInWithPassword,
    signUpWithPassword,
    sendPasswordReset,
  } = useAuth()
  const isConnectMode = onCancel !== undefined

  const [panel, setPanel] = useState<Panel>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [resendIn, setResendIn] = useState(0)

  useEffect(() => {
    if (resendIn <= 0) return
    const id = window.setInterval(() => setResendIn((n) => Math.max(0, n - 1)), 1000)
    return () => clearInterval(id)
  }, [resendIn])

  const emailOk = isValidEmail(email)
  const pwProblem = passwordProblem(password)

  // Every submit funnels through here so busy state and error handling can't drift.
  async function run(action: () => Promise<{ kind: string; message?: string; email?: string }>) {
    setError(null)
    setNotice(null)
    setIsBusy(true)
    try {
      const result = await action()
      if (result.kind === 'error') setError(result.message ?? 'Something went wrong.')
      else if (result.kind === 'code-sent') {
        setPanel('code')
        setResendIn(RESEND_SECONDS)
        setNotice(`We sent a sign-in code to ${result.email ?? email}.`)
      } else if (result.kind === 'reset-sent') {
        setPanel('password')
        setNotice('Check your email for a link to set a new password.')
      }
      // 'session' needs nothing: the session change unmounts this screen.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong.')
    } finally {
      setIsBusy(false)
    }
  }

  const emailField = (
    <>
      <label
        htmlFor="signin-email"
        className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-ink-muted"
      >
        Email
      </label>
      <input
        id="signin-email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        value={email}
        onChange={(event) => {
          setEmail(event.target.value)
          setError(null)
        }}
        placeholder="you@example.com"
        className="h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-[16px] outline-none focus:border-accent"
      />
    </>
  )

  function passwordField(label: string, autoComplete: string) {
    return (
      <>
        <label
          htmlFor="signin-password"
          className="mb-1.5 mt-3 block text-[12px] font-semibold uppercase tracking-wide text-ink-muted"
        >
          {label}
        </label>
        <input
          id="signin-password"
          type="password"
          autoComplete={autoComplete}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value)
            setError(null)
          }}
          placeholder="••••••••"
          className="h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-[16px] outline-none focus:border-accent"
        />
      </>
    )
  }

  return (
    <div className="flex h-full flex-col justify-center bg-page px-6 pb-safe pt-safe">
      <div className="mx-auto w-full max-w-sm">
        {isConnectMode && (
          <button
            onClick={onCancel}
            className="mb-4 flex items-center gap-1.5 text-[14px] font-semibold text-accent"
          >
            <ArrowLeft size={16} />
            Back
          </button>
        )}

        {panel !== 'code' && (
          <div className="mb-8 text-center">
            <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-contrast">
              <Dumbbell size={28} />
            </span>
            <h1 className="mt-4 text-[26px] font-bold tracking-tight">
              {isConnectMode
                ? 'Sync your account'
                : panel === 'signup'
                  ? 'Create your account'
                  : panel === 'forgot'
                    ? 'Reset your password'
                    : 'REPutation'}
            </h1>
            <p className="mt-1.5 text-[14.5px] text-ink-secondary">
              {isConnectMode
                ? 'Everything you logged on this device comes with you and syncs across your devices.'
                : panel === 'forgot'
                  ? 'We’ll email you a link to choose a new one.'
                  : 'Log your lifts, watch the numbers move.'}
            </p>
          </div>
        )}

        {panel === 'password' && (
          <>
            {emailField}
            {passwordField('Password', 'current-password')}

            <Button
              size="lg"
              className="mt-3 w-full"
              disabled={!emailOk || password.length === 0 || isBusy}
              onClick={() => void run(() => signInWithPassword(email, password))}
            >
              <KeyRound size={18} />
              Sign in
            </Button>

            {notice && <Notice>{notice}</Notice>}
            {error && <ErrorNote>{error}</ErrorNote>}

            <div className="mt-3 flex justify-between text-[13.5px] font-semibold">
              <button
                onClick={() => {
                  setPanel('signup')
                  setError(null)
                }}
                className="text-accent active:opacity-60"
              >
                Create an account
              </button>
              <button
                onClick={() => {
                  setPanel('forgot')
                  setError(null)
                }}
                className="text-ink-secondary active:opacity-60"
              >
                Forgot password?
              </button>
            </div>

            <Divider />

            <button
              onClick={() => void run(() => signInWithEmail(email))}
              disabled={!emailOk || isBusy}
              className="flex w-full items-center justify-center gap-2 py-2 text-[14px] font-semibold text-ink-secondary active:opacity-60 disabled:opacity-40"
            >
              <Mail size={15} />
              Email me a code instead
            </button>

            {!isConnectMode && (
              <button
                onClick={() => void run(() => continueOffline())}
                disabled={isBusy}
                className="mt-1 flex w-full items-center justify-center gap-2 py-2 text-[14px] font-semibold text-ink-secondary active:opacity-60"
              >
                <WifiOff size={15} />
                Use this device only
              </button>
            )}
          </>
        )}

        {panel === 'signup' && (
          <>
            {emailField}
            {passwordField('Choose a password', 'new-password')}
            <p className="mt-1.5 text-[12px] text-ink-muted">
              {pwProblem ?? 'Looks good.'}
            </p>

            <Button
              size="lg"
              className="mt-3 w-full"
              disabled={!emailOk || pwProblem !== null || isBusy}
              onClick={() => void run(() => signUpWithPassword(email, password))}
            >
              Create account
            </Button>

            {error && <ErrorNote>{error}</ErrorNote>}

            <button
              onClick={() => {
                setPanel('password')
                setError(null)
              }}
              className="mt-4 w-full py-2 text-[14px] font-semibold text-accent active:opacity-60"
            >
              I already have an account
            </button>
          </>
        )}

        {panel === 'forgot' && (
          <>
            {emailField}
            <Button
              size="lg"
              className="mt-3 w-full"
              disabled={!emailOk || isBusy}
              onClick={() => void run(() => sendPasswordReset(email))}
            >
              <Mail size={18} />
              Email me a reset link
            </Button>

            {error && <ErrorNote>{error}</ErrorNote>}

            <button
              onClick={() => {
                setPanel('password')
                setError(null)
              }}
              className="mt-4 w-full py-2 text-[14px] font-semibold text-accent active:opacity-60"
            >
              Back to sign in
            </button>
          </>
        )}

        {panel === 'code' && (
          <>
            <button
              onClick={() => {
                setPanel('password')
                setCode('')
                setError(null)
              }}
              className="mb-6 flex items-center gap-1.5 text-[14px] font-semibold text-accent"
            >
              <ArrowLeft size={16} />
              Back to sign in
            </button>

            <h1 className="text-[24px] font-bold tracking-tight">Check your email</h1>
            <p className="mt-2 text-[14.5px] text-ink-secondary">
              We sent a sign-in link to <span className="font-semibold">{email}</span>.
              Tap it on this device and you're in — no code needed.
            </p>

            <div className="mt-6 flex items-center gap-3">
              <span className="h-px flex-1 bg-line-strong" />
              <span className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">
                or enter the code
              </span>
              <span className="h-px flex-1 bg-line-strong" />
            </div>
            <p className="mb-1.5 mt-4 text-[12.5px] text-ink-muted">
              If the link opened in a different browser, paste the code from that same
              email here.
            </p>
            <label htmlFor="signin-code" className="sr-only">
              Code
            </label>
            <input
              id="signin-code"
              // Not `numeric`: an emailed token may contain letters.
              inputMode="text"
              autoComplete="one-time-code"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={CODE_MAX_LENGTH}
              value={code}
              onChange={(event) => {
                // Only strip whitespace; the token isn't guaranteed numeric.
                setCode(event.target.value.replace(/\s+/g, ''))
                setError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && isSubmittableCode(code)) {
                  void run(() => verifyCode(email, code.trim()))
                }
              }}
              placeholder="Paste your code"
              className="tabular h-14 w-full rounded-xl border border-line bg-surface text-center text-[22px] font-bold tracking-[0.2em] outline-none focus:border-accent"
            />

            <Button
              size="lg"
              className="mt-3 w-full"
              disabled={!isSubmittableCode(code) || isBusy}
              onClick={() => void run(() => verifyCode(email, code.trim()))}
            >
              {isBusy ? 'Signing in…' : 'Sign in'}
            </Button>

            {error && <ErrorNote>{error}</ErrorNote>}

            <button
              onClick={() => void run(() => signInWithEmail(email))}
              disabled={resendIn > 0 || isBusy}
              className={cn(
                'mt-4 w-full py-2 text-[14px] font-semibold',
                resendIn > 0 ? 'text-ink-muted' : 'text-accent active:opacity-60',
              )}
            >
              {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend the link'}
            </button>

            {/* The local provider has no mail server, so the accepted code is stated plainly. */}
            {!HAS_BACKEND && (
              <p className="mt-6 rounded-xl border border-dashed border-line-strong px-3.5 py-2.5 text-center text-[12.5px] text-ink-muted">
                No server is connected yet, so no email was actually sent. Use code{' '}
                <span className="tabular font-bold text-ink">{LOCAL_DEV_CODE}</span>.
              </p>
            )}
          </>
        )}

        <p className="mt-6 text-center text-[11.5px] text-ink-muted">
          By signing in you agree to the{' '}
          <a
            href="https://reputation.fitness/app/privacy.html"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-line-strong underline-offset-2 active:opacity-60"
          >
            privacy policy
          </a>
          .
        </p>
      </div>
    </div>
  )
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="mt-3 rounded-xl px-3.5 py-2.5 text-[13.5px]"
      style={{
        background: 'color-mix(in srgb, var(--status-critical) 10%, transparent)',
        color: 'var(--status-critical)',
      }}
    >
      {children}
    </p>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 rounded-xl bg-accent-wash px-3.5 py-2.5 text-[13.5px] text-accent">
      {children}
    </p>
  )
}

function Divider() {
  return (
    <div className="my-5 flex items-center gap-3">
      <span className="h-px flex-1 bg-line-strong" />
      <span className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
        or
      </span>
      <span className="h-px flex-1 bg-line-strong" />
    </div>
  )
}
