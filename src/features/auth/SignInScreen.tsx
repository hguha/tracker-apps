import { useEffect, useState } from 'react'
import { ArrowLeft, Dumbbell, Mail, WifiOff } from 'lucide-react'
import { Button } from '@/components/Button'
import { useAuth } from '@/auth/AuthContext'
import { CODE_MAX_LENGTH, isSubmittableCode, isValidEmail } from '@/auth/types'
import { LOCAL_DEV_CODE } from '@/auth/localAuthProvider'
import { isBackendConfigured } from '@/sync/supabaseClient'
import { cn } from '@/lib/cn'

const RESEND_SECONDS = 30

// With a real backend, the dev-code note and offline path are hidden.
const HAS_BACKEND = isBackendConfigured()

export function SignInScreen({
  // Present in "connect account" mode: a device-only user upgrading to a real account.
  onCancel,
}: {
  onCancel?: () => void
} = {}) {
  const { signInWithEmail, verifyCode, continueOffline } = useAuth()
  const isConnectMode = onCancel !== undefined

  const [panel, setPanel] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [resendIn, setResendIn] = useState(0)

  useEffect(() => {
    if (resendIn <= 0) return
    const id = window.setInterval(() => setResendIn((n) => Math.max(0, n - 1)), 1000)
    return () => clearInterval(id)
  }, [resendIn])

  const isCodeSubmittable = isSubmittableCode(code)

  async function sendLink() {
    setError(null)
    setIsBusy(true)
    try {
      const result = await signInWithEmail(email)
      if (result.kind === 'error') setError(result.message)
      else if (result.kind === 'code-sent') {
        setPanel('code')
        setResendIn(RESEND_SECONDS)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not send that email.')
    } finally {
      setIsBusy(false)
    }
  }

  async function submitCode() {
    setError(null)
    setIsBusy(true)
    try {
      const result = await verifyCode(email, code.trim())
      // On success the session change propagates and this screen unmounts.
      if (result.kind === 'error') setError(result.message)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not verify that code.')
    } finally {
      setIsBusy(false)
    }
  }

  async function useOffline() {
    setError(null)
    setIsBusy(true)
    try {
      await continueOffline()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not continue offline.')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col justify-center bg-page px-6 pb-safe pt-safe">
      <div className="mx-auto w-full max-w-sm">
        {panel === 'email' ? (
          <>
            {isConnectMode && (
              <button
                onClick={onCancel}
                className="mb-4 flex items-center gap-1.5 text-[14px] font-semibold text-accent"
              >
                <ArrowLeft size={16} />
                Back
              </button>
            )}
            <div className="mb-8 text-center">
              <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-contrast">
                <Dumbbell size={28} />
              </span>
              <h1 className="mt-4 text-[26px] font-bold tracking-tight">
                {isConnectMode ? 'Sync your account' : 'FitNote'}
              </h1>
              <p className="mt-1.5 text-[14.5px] text-ink-secondary">
                {isConnectMode
                  ? 'Everything you logged on this device comes with you and syncs across your devices.'
                  : 'Log your lifts, watch the numbers move.'}
              </p>
            </div>

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
              onKeyDown={(event) => {
                if (event.key === 'Enter' && isValidEmail(email)) void sendLink()
              }}
              placeholder="you@example.com"
              className="h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-[16px] outline-none focus:border-accent"
            />

            <Button
              size="lg"
              className="mt-3 w-full"
              disabled={!isValidEmail(email) || isBusy}
              onClick={() => void sendLink()}
            >
              <Mail size={18} />
              Email me a link
            </Button>

            {error && <ErrorNote>{error}</ErrorNote>}

            {!isConnectMode && (
              <>
                <Divider />

                <button
                  onClick={() => void useOffline()}
                  disabled={isBusy}
                  className="flex w-full items-center justify-center gap-2 py-2 text-[14px] font-semibold text-ink-secondary active:opacity-60"
                >
                  <WifiOff size={15} />
                  Use this device only
                </button>
              </>
            )}

            <p className="mt-6 text-center text-[12.5px] leading-relaxed text-ink-muted">
              {isConnectMode
                ? 'Enter your email and we’ll send a sign-in link. Your on-device history is preserved and uploaded once you’re signed in.'
                : HAS_BACKEND
                  ? 'New here? The same email creates your account and syncs across your devices. “This device only” keeps everything in this browser — nothing is uploaded.'
                  : '“This device only” keeps everything in this browser — nothing is uploaded and nothing syncs.'}
            </p>
          </>
        ) : (
          <>
            <button
              onClick={() => {
                setPanel('email')
                setCode('')
                setError(null)
              }}
              className="mb-6 flex items-center gap-1.5 text-[14px] font-semibold text-accent"
            >
              <ArrowLeft size={16} />
              Use a different address
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
                if (event.key === 'Enter' && isCodeSubmittable) void submitCode()
              }}
              placeholder="Paste your code"
              className="tabular h-14 w-full rounded-xl border border-line bg-surface text-center text-[22px] font-bold tracking-[0.2em] outline-none focus:border-accent"
            />

            <Button
              size="lg"
              className="mt-3 w-full"
              disabled={!isCodeSubmittable || isBusy}
              onClick={() => void submitCode()}
            >
              {isBusy ? 'Signing in…' : 'Sign in'}
            </Button>

            {error && <ErrorNote>{error}</ErrorNote>}

            <button
              onClick={() => void sendLink()}
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
