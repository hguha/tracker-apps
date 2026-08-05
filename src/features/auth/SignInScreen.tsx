/**
 * Sign in (§11.1.2).
 *
 * Two panels: the email form, then check-your-email. The second panel exists as a
 * real screen rather than a toast because it has to carry the address, a resend
 * timer, a way back, and the code fallback for when the link opens in a different
 * browser than the one that asked for it.
 *
 * Invite-only is stated up front — a stranger should learn that here, not by
 * waiting for a link that will never arrive.
 */

import { useEffect, useState } from 'react'
import { ArrowLeft, Dumbbell, Mail, WifiOff } from 'lucide-react'
import { Button } from '@/components/Button'
import { useAuth } from '@/auth/AuthContext'
import { isValidEmail } from '@/auth/types'
import { LOCAL_DEV_CODE } from '@/auth/localAuthProvider'
import { cn } from '@/lib/cn'

const RESEND_SECONDS = 30

export function SignInScreen() {
  const { signInWithEmail, verifyCode, signInWithGoogle, continueOffline } = useAuth()

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
    } finally {
      setIsBusy(false)
    }
  }

  async function submitCode() {
    setError(null)
    setIsBusy(true)
    try {
      const result = await verifyCode(email, code)
      // On success the session change propagates and this screen unmounts.
      if (result.kind === 'error') setError(result.message)
    } finally {
      setIsBusy(false)
    }
  }

  async function useGoogle() {
    setError(null)
    const result = await signInWithGoogle()
    if (result.kind === 'error') setError(result.message)
  }

  async function useOffline() {
    setError(null)
    setIsBusy(true)
    try {
      await continueOffline()
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col justify-center bg-page px-6 pb-safe pt-safe">
      <div className="mx-auto w-full max-w-sm">
        {panel === 'email' ? (
          <>
            <div className="mb-8 text-center">
              <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-accent text-white">
                <Dumbbell size={28} />
              </span>
              <h1 className="mt-4 text-[26px] font-bold tracking-tight">
                Workout Tracker
              </h1>
              <p className="mt-1.5 text-[14.5px] text-ink-secondary">
                Log your lifts, watch the numbers move.
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

            <Divider />

            <Button
              variant="secondary"
              size="lg"
              className="w-full"
              onClick={() => void useGoogle()}
            >
              Continue with Google
            </Button>

            <button
              onClick={() => void useOffline()}
              disabled={isBusy}
              className="mt-3 flex w-full items-center justify-center gap-2 py-2 text-[14px] font-semibold text-ink-secondary active:opacity-60"
            >
              <WifiOff size={15} />
              Use this device only
            </button>

            <p className="mt-6 text-center text-[12.5px] leading-relaxed text-ink-muted">
              Sign-up is invite only. Choosing “this device only” keeps everything
              in this browser — nothing is uploaded and nothing syncs.
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
              Open it on this device, or enter the 6-digit code below.
            </p>

            <label
              htmlFor="signin-code"
              className="mb-1.5 mt-6 block text-[12px] font-semibold uppercase tracking-wide text-ink-muted"
            >
              Code
            </label>
            <input
              id="signin-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => {
                setCode(event.target.value.replace(/\D/g, ''))
                setError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && code.length === 6) void submitCode()
              }}
              placeholder="000000"
              className="tabular h-14 w-full rounded-xl border border-line bg-surface text-center text-[26px] font-bold tracking-[0.3em] outline-none focus:border-accent"
            />

            <Button
              size="lg"
              className="mt-3 w-full"
              disabled={code.length !== 6 || isBusy}
              onClick={() => void submitCode()}
            >
              Sign in
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

            {/*
              The local provider has no mail server, so the accepted code is
              stated plainly. This block disappears with the real provider.
            */}
            <p className="mt-6 rounded-xl border border-dashed border-line-strong px-3.5 py-2.5 text-center text-[12.5px] text-ink-muted">
              No server is connected yet, so no email was actually sent. Use code{' '}
              <span className="tabular font-bold text-ink">{LOCAL_DEV_CODE}</span>.
            </p>
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
