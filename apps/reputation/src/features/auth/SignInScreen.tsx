import { useEffect, useState } from 'react'
import { ArrowLeft, Dumbbell, Mail, WifiOff } from 'lucide-react'
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

// Matches the server's per-address email cooldown (~60s); a shorter timer would just
// enable an avoidable 429.
const RESEND_SECONDS = 60

// With a real backend, the dev-code note and offline path are hidden.
const HAS_BACKEND = isBackendConfigured()

/**
 * The auth flow, as one intent per screen.
 *
 * `welcome` exists because a combined screen is genuinely ambiguous: an email box
 * next to a password box reads as two different offers, and the user can't tell
 * whether typing both signs them in or creates an account. So the first thing asked
 * is which one they're doing, and every later panel does exactly that one thing.
 *
 * Confirmation and sign-in codes are entered as codes rather than followed as links.
 * A link carries a redirect URL that depends on where sign-up happened — a dev
 * origin, a preview deploy, or a custom scheme the native shell owns — and it breaks
 * outright when the email is read on a different device. A code has no redirect, so
 * it behaves identically on the web, an installed PWA, and inside the native app.
 */
type Panel =
  | 'welcome'
  | 'sign-in'
  | 'sign-up'
  | 'confirm'
  | 'code'
  | 'forgot'

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
    resendConfirmation,
    verifySignupCode,
  } = useAuth()
  const isConnectMode = onCancel !== undefined

  const [panel, setPanel] = useState<Panel>('welcome')
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

  function go(next: Panel) {
    setPanel(next)
    setError(null)
    setNotice(null)
    setCode('')
  }

  // Every submit funnels through here so busy state and result handling can't drift.
  async function run(
    action: () => Promise<{ kind: string; message?: string; email?: string }>,
  ) {
    setError(null)
    setNotice(null)
    setIsBusy(true)
    try {
      const result = await action()
      if (result.kind === 'error') setError(result.message ?? 'Something went wrong.')
      else if (result.kind === 'code-sent') {
        setPanel('code')
        setCode('')
        setResendIn(RESEND_SECONDS)
      } else if (result.kind === 'confirm-sent') {
        setPanel('confirm')
        setCode('')
        setResendIn(RESEND_SECONDS)
      } else if (result.kind === 'reset-sent') {
        setPanel('sign-in')
        setNotice('Check your email for a link to choose a new password.')
      }
      // 'session' needs nothing: the session change unmounts this screen.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong.')
    } finally {
      setIsBusy(false)
    }
  }

  const emailField = (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
        Email
      </span>
      <input
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect="off"
        value={email}
        onChange={(event) => {
          setEmail(event.target.value)
          setError(null)
        }}
        placeholder="you@example.com"
        className="h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-[16px] outline-none focus:border-accent"
      />
    </label>
  )

  function passwordFieldFor(mode: 'current' | 'new') {
    return (
      <label className="mt-3 block">
        <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
          {mode === 'new' ? 'Create a password' : 'Password'}
        </span>
        <input
          type="password"
          autoComplete={mode === 'new' ? 'new-password' : 'current-password'}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value)
            setError(null)
          }}
          placeholder="••••••••"
          className="h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-[16px] outline-none focus:border-accent"
        />
        {mode === 'new' && (
          <span className="mt-1.5 block text-[12px] text-ink-muted">
            {pwProblem ?? 'Strong enough.'}
          </span>
        )}
      </label>
    )
  }

  // A shared code panel: same input for a sign-in code and a sign-up confirmation,
  // differing only in what submitting it does.
  function codePanel({
    title,
    blurb,
    onSubmit,
    onResend,
  }: {
    title: string
    blurb: React.ReactNode
    onSubmit: () => Promise<{ kind: string; message?: string; email?: string }>
    onResend: () => Promise<{ kind: string; message?: string; email?: string }>
  }) {
    return (
      <>
        <h1 className="text-[24px] font-bold tracking-tight">{title}</h1>
        <p className="mt-2 text-[14.5px] text-ink-secondary">{blurb}</p>

        <label className="mt-6 block">
          <span className="sr-only">Code</span>
          <input
            // Not `numeric`: an emailed token may contain letters.
            inputMode="text"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            maxLength={CODE_MAX_LENGTH}
            value={code}
            onChange={(event) => {
              setCode(event.target.value.replace(/\s+/g, ''))
              setError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && isSubmittableCode(code)) void run(onSubmit)
            }}
            placeholder="000000"
            className="tabular h-14 w-full rounded-xl border border-line bg-surface text-center text-[22px] font-bold tracking-[0.3em] outline-none focus:border-accent"
          />
        </label>

        <Button
          size="lg"
          className="mt-3 w-full"
          disabled={!isSubmittableCode(code) || isBusy}
          onClick={() => void run(onSubmit)}
        >
          {isBusy ? 'Checking…' : 'Continue'}
        </Button>

        {error && <ErrorNote>{error}</ErrorNote>}

        <button
          onClick={() => void run(onResend)}
          disabled={resendIn > 0 || isBusy}
          className={cn(
            'mt-4 w-full py-2 text-[14px] font-semibold',
            resendIn > 0 ? 'text-ink-muted' : 'text-accent active:opacity-60',
          )}
        >
          {resendIn > 0 ? `Resend in ${resendIn}s` : 'Send a new code'}
        </button>

        {!HAS_BACKEND && (
          <p className="mt-4 rounded-xl border border-dashed border-line-strong px-3.5 py-2.5 text-center text-[12.5px] text-ink-muted">
            No server is connected, so no email was sent. Use code{' '}
            <span className="tabular font-bold text-ink">{LOCAL_DEV_CODE}</span>.
          </p>
        )}
      </>
    )
  }

  const showBack = panel !== 'welcome' || isConnectMode

  return (
    <div className="flex h-full flex-col justify-center bg-page px-6 pb-safe pt-safe">
      <div className="mx-auto w-full max-w-sm">
        {showBack && (
          <button
            onClick={() => (panel === 'welcome' ? onCancel?.() : go('welcome'))}
            className="mb-4 flex items-center gap-1.5 text-[14px] font-semibold text-accent"
          >
            <ArrowLeft size={16} />
            Back
          </button>
        )}

        {panel === 'welcome' && (
          <>
            <div className="mb-8 text-center">
              <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-contrast">
                <Dumbbell size={28} />
              </span>
              <h1 className="mt-4 text-[26px] font-bold tracking-tight">
                {isConnectMode ? 'Sync your account' : 'REPutation'}
              </h1>
              <p className="mt-1.5 text-[14.5px] text-ink-secondary">
                {isConnectMode
                  ? 'Everything you logged on this device comes with you and syncs across your devices.'
                  : 'Log your lifts, watch the numbers move.'}
              </p>
            </div>

            <Button size="lg" className="w-full" onClick={() => go('sign-up')}>
              Create an account
            </Button>
            <Button
              size="lg"
              variant="secondary"
              className="mt-2.5 w-full"
              onClick={() => go('sign-in')}
            >
              I already have an account
            </Button>

            {!isConnectMode && (
              <>
                <Divider />
                <button
                  onClick={() => void run(() => continueOffline())}
                  disabled={isBusy}
                  className="flex w-full items-center justify-center gap-2 py-2 text-[14px] font-semibold text-ink-secondary active:opacity-60"
                >
                  <WifiOff size={15} />
                  Use this device only
                </button>
                <p className="mt-2 text-center text-[12.5px] leading-relaxed text-ink-muted">
                  No account needed — everything stays in this browser. You can add an
                  account later and keep what you logged.
                </p>
              </>
            )}
          </>
        )}

        {panel === 'sign-in' && (
          <>
            <h1 className="text-[24px] font-bold tracking-tight">Welcome back</h1>
            <p className="mt-1.5 text-[14.5px] text-ink-secondary">
              Sign in with your password, or have a one-time code emailed instead.
            </p>

            <div className="mt-6">{emailField}</div>
            {passwordFieldFor('current')}

            <Button
              size="lg"
              className="mt-3 w-full"
              disabled={!emailOk || password.length === 0 || isBusy}
              onClick={() => void run(() => signInWithPassword(email, password))}
            >
              {isBusy ? 'Signing in…' : 'Sign in'}
            </Button>

            {notice && <Notice>{notice}</Notice>}
            {error && <ErrorNote>{error}</ErrorNote>}

            <button
              onClick={() => go('forgot')}
              className="mt-3 w-full py-2 text-[13.5px] font-semibold text-ink-secondary active:opacity-60"
            >
              Forgot your password?
            </button>

            <Divider />

            <button
              onClick={() => void run(() => signInWithEmail(email))}
              disabled={!emailOk || isBusy}
              className="flex w-full items-center justify-center gap-2 py-2 text-[14px] font-semibold text-accent active:opacity-60 disabled:opacity-40"
            >
              <Mail size={15} />
              Email me a one-time code
            </button>
          </>
        )}

        {panel === 'sign-up' && (
          <>
            <h1 className="text-[24px] font-bold tracking-tight">Create your account</h1>
            <p className="mt-1.5 text-[14.5px] text-ink-secondary">
              We'll email you a code to confirm the address. Your password is how you
              sign in after that.
            </p>

            <div className="mt-6">{emailField}</div>
            {passwordFieldFor('new')}

            <Button
              size="lg"
              className="mt-3 w-full"
              disabled={!emailOk || pwProblem !== null || isBusy}
              onClick={() => void run(() => signUpWithPassword(email, password))}
            >
              {isBusy ? 'Creating…' : 'Create account'}
            </Button>

            {error && <ErrorNote>{error}</ErrorNote>}

            <p className="mt-4 text-center text-[12.5px] text-ink-muted">
              Already have one?{' '}
              <button
                onClick={() => go('sign-in')}
                className="font-semibold text-accent active:opacity-60"
              >
                Sign in instead
              </button>
            </p>
          </>
        )}

        {panel === 'confirm' &&
          codePanel({
            title: 'Confirm your email',
            blurb: (
              <>
                We sent a 6-digit code to{' '}
                <span className="font-semibold text-ink">{email}</span>. Enter it to
                finish setting up your account.
              </>
            ),
            onSubmit: () => verifySignupCode(email, code.trim()),
            onResend: () => resendConfirmation(email),
          })}

        {panel === 'code' &&
          codePanel({
            title: 'Check your email',
            blurb: (
              <>
                We sent a one-time code to{' '}
                <span className="font-semibold text-ink">{email}</span>.
              </>
            ),
            onSubmit: () => verifyCode(email, code.trim()),
            onResend: () => signInWithEmail(email),
          })}

        {panel === 'forgot' && (
          <>
            <h1 className="text-[24px] font-bold tracking-tight">Reset your password</h1>
            <p className="mt-1.5 text-[14.5px] text-ink-secondary">
              We'll email you a link to choose a new one.
            </p>

            <div className="mt-6">{emailField}</div>
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
              onClick={() => go('sign-in')}
              className="mt-4 w-full py-2 text-[14px] font-semibold text-accent active:opacity-60"
            >
              Back to sign in
            </button>
          </>
        )}

        <p className="mt-6 text-center text-[11.5px] text-ink-muted">
          By continuing you agree to the{' '}
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
