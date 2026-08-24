// Sign-in: email one-time code when a backend is configured, plus a "continue on this
// device" path so the app is fully usable with no account (principle #1). Reuses the
// shared auth contract's validators.

import { useState } from 'react'
import { Button } from '@tracker-engine/ui'
import { isSubmittableCode, isValidEmail } from '@tracker-engine/auth'
import { useAuth } from '@/auth/AuthContext'

export function SignInScreen() {
  const { isLocalOnly, signInWithEmail, verifyCode, continueOffline } = useAuth()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<'email' | 'code'>('email')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function sendCode() {
    setBusy(true)
    setError(null)
    const result = await signInWithEmail(email)
    setBusy(false)
    if (result.kind === 'code-sent') setStage('code')
    else if (result.kind === 'error') setError(result.message)
  }

  async function submitCode() {
    setBusy(true)
    setError(null)
    const result = await verifyCode(email, code)
    setBusy(false)
    if (result.kind === 'error') setError(result.message)
  }

  return (
    <div className="mx-auto flex h-full max-w-sm flex-col justify-center gap-6 px-6">
      <div className="text-center">
        <div className="text-4xl">📒</div>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">Ledger</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Your money, tracked privately on your device.
        </p>
      </div>

      {!isLocalOnly && stage === 'email' && (
        <div className="flex flex-col gap-3">
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12 rounded-xl border border-line bg-surface px-4 text-ink outline-none focus:border-accent"
          />
          <Button onClick={sendCode} disabled={!isValidEmail(email) || busy}>
            {busy ? 'Sending…' : 'Email me a code'}
          </Button>
        </div>
      )}

      {!isLocalOnly && stage === 'code' && (
        <div className="flex flex-col gap-3">
          <p className="text-center text-sm text-ink-muted">
            Enter the code sent to <b>{email}</b>.
          </p>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="h-12 rounded-xl border border-line bg-surface px-4 text-center text-lg tracking-widest text-ink outline-none focus:border-accent"
          />
          <Button onClick={submitCode} disabled={!isSubmittableCode(code) || busy}>
            {busy ? 'Verifying…' : 'Verify & sign in'}
          </Button>
          <Button variant="ghost" onClick={() => setStage('email')} disabled={busy}>
            Use a different email
          </Button>
        </div>
      )}

      {error && <p className="text-center text-sm text-critical">{error}</p>}

      {/* Device-only path only when there's no backend to sign in to. With a project
          configured, email sign-in is required so the ledger is backed up + synced. */}
      {isLocalOnly && (
        <div className="flex flex-col items-center gap-2">
          <Button variant="secondary" onClick={() => void continueOffline()} disabled={busy}>
            Continue on this device
          </Button>
          <p className="max-w-xs text-center text-xs text-ink-muted">
            A device-only book stays private and never leaves this device.
          </p>
        </div>
      )}
    </div>
  )
}
