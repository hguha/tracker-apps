import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { Button } from '@/components/Button'
import { useAuth } from '@/auth/AuthContext'
import { passwordProblem } from '@/auth/types'

/**
 * Shown after landing from a password-reset email. The recovery link already
 * signed the user in, so this is the only thing standing between them and the app
 * — without it the reset intent would be silently dropped.
 */
export function SetPasswordScreen() {
  const { updatePassword, clearPasswordRecovery, signOut } = useAuth()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const problem = passwordProblem(password)

  async function save() {
    if (problem !== null) return
    setError(null)
    setIsBusy(true)
    try {
      await updatePassword(password)
      clearPasswordRecovery()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not set that password.')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    // Centred with `m-auto` inside a scroller, so a short viewport can never leave
    // the fields above the fold with no way to reach them (see SignInScreen).
    <div className="flex h-full flex-col overflow-y-auto bg-page px-6 pb-safe pt-safe">
      <div className="m-auto w-full max-w-sm py-6">
        <div className="mb-8 text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-contrast">
            <KeyRound size={26} />
          </span>
          <h1 className="mt-4 text-[26px] font-bold tracking-tight">Choose a new password</h1>
          <p className="mt-1.5 text-[14.5px] text-ink-secondary">
            You're signed in — set a password to finish.
          </p>
        </div>

        <label
          htmlFor="new-password"
          className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-ink-muted"
        >
          New password
        </label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value)
            setError(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save()
          }}
          placeholder="••••••••"
          className="h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-[16px] outline-none focus:border-accent"
        />
        <p className="mt-1.5 text-[12px] text-ink-muted">{problem ?? 'Looks good.'}</p>

        <Button
          size="lg"
          className="mt-3 w-full"
          disabled={problem !== null || isBusy}
          onClick={() => void save()}
        >
          {isBusy ? 'Saving…' : 'Save password'}
        </Button>

        {error && (
          <p
            role="alert"
            className="mt-3 rounded-xl px-3.5 py-2.5 text-[13.5px]"
            style={{
              background: 'color-mix(in srgb, var(--status-critical) 10%, transparent)',
              color: 'var(--status-critical)',
            }}
          >
            {error}
          </p>
        )}

        <button
          onClick={() => {
            clearPasswordRecovery()
            void signOut()
          }}
          className="mt-4 w-full py-2 text-[14px] font-semibold text-ink-secondary active:opacity-60"
        >
          Cancel and sign out
        </button>
      </div>
    </div>
  )
}
