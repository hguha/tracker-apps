import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft } from 'lucide-react'
import { Button, Card, useToast } from '@tracker-engine/ui'
import { isValidPassword, passwordProblem } from '@tracker-engine/auth'
import { useAuth } from '@/auth/AuthContext'
import * as repo from '@/data/repository'

export function AccountScreen({
  onBack,
  onConnect,
}: {
  onBack: () => void
  onConnect?: () => void
}) {
  const toast = useToast()
  const auth = useAuth()
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)
  const [name, setName] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const session = auth.session
  const displayName = name ?? profile?.displayName ?? ''

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-line bg-surface px-2 py-2 pt-safe">
        <button
          onClick={onBack}
          aria-label="Back"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-secondary active:bg-sunken"
        >
          <ChevronLeft size={22} />
        </button>
        <h1 className="flex-1 text-[16px] font-semibold tracking-tight">Account</h1>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <Card className="p-4">
          <h2 className="text-[15px] font-semibold tracking-tight">You</h2>
          <dl className="mt-2 space-y-1.5 text-[13.5px]">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-secondary">Email</dt>
              <dd className="truncate font-semibold">{session?.email ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-secondary">Mode</dt>
              <dd className="font-semibold">
                {session?.isLocal ? 'This device only' : 'Synced account'}
              </dd>
            </div>
          </dl>

          <label className="mt-3 block">
            <span className="text-[12px] text-ink-muted">Display name</span>
            <input
              value={displayName}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 h-11 w-full rounded-xl bg-sunken px-3 text-[15px] outline-none"
            />
          </label>
          <Button
            variant="secondary"
            className="mt-2 w-full"
            disabled={name === null || name.trim() === profile?.displayName}
            onClick={() => {
              const trimmed = displayName.trim()
              if (!trimmed) return
              void Promise.all([
                repo.saveProfile({ displayName: trimmed }),
                auth.updateDisplayName(trimmed),
              ]).then(() => {
                setName(null)
                toast.show('Name updated')
              })
            }}
          >
            Save name
          </Button>
        </Card>

        {!session?.isLocal && <PasswordCard />}

        {/* Device-only has nothing to sign out *of*: the session is this browser, so signing
            out would strand the user at the welcome screen with their data still sitting here.
            Offer connecting an account instead — that's the action they actually want. */}
        {session?.isLocal ? (
          <Card className="p-4">
            <h2 className="text-[15px] font-semibold tracking-tight">This device only</h2>
            <p className="mt-1 text-[12.5px] text-ink-muted">
              Everything you&rsquo;ve logged lives in this browser. Connect an account to sync it
              across devices and back it up — nothing is replaced.
            </p>
            {onConnect && (
              <Button variant="secondary" className="mt-2 w-full" onClick={onConnect}>
                Connect an account
              </Button>
            )}
          </Card>
        ) : (
          <Card className="p-4">
            <h2 className="text-[15px] font-semibold tracking-tight">Sign out</h2>
            <p className="mt-1 text-[12.5px] text-ink-muted">
              Your synced data stays on your account. This device&rsquo;s copy is cleared.
            </p>
            <Button
              variant="secondary"
              className="mt-2 w-full"
              onClick={() => void auth.signOut()}
            >
              Sign out
            </Button>
          </Card>
        )}

        <Card className="p-4">
          <h2 className="text-[15px] font-semibold tracking-tight">
            {session?.isLocal ? 'Erase this device' : 'Delete account'}
          </h2>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            {session?.isLocal
              ? 'Removes every log, weigh-in and check-in from this browser. There is no account to delete and nothing is stored elsewhere, so this cannot be undone.'
              : 'Removes your account and every row of it from the server, and wipes this device. Cannot be undone.'}
          </p>
          <button
            disabled={isDeleting}
            onClick={() => {
              const ok = window.confirm(
                session?.isLocal
                  ? 'Erase everything logged on this device? This cannot be undone.'
                  : 'Permanently delete your account and all of its data? This cannot be undone.',
              )
              if (!ok) return
              setIsDeleting(true)
              // Awaited, and the local wipe only runs on success: reporting "deleted" from a
              // fire-and-forget call is how REPutation hid a 404 for months.
              void auth
                .deleteAccount()
                .then(async () => {
                  await repo.clearLocalData()
                  repo.clearDbOwner()
                  toast.show('Account deleted')
                })
                .catch((error: unknown) => {
                  toast.show(
                    error instanceof Error ? error.message : 'Could not delete the account',
                  )
                })
                .finally(() => setIsDeleting(false))
            }}
            className="mt-2 w-full rounded-xl py-2.5 text-[14px] font-semibold active:opacity-60"
            style={{ color: 'var(--status-critical)' }}
          >
            {isDeleting ? 'Deleting…' : session?.isLocal ? 'Erase my data' : 'Delete my account'}
          </button>
        </Card>
      </div>
    </div>
  )
}

function PasswordCard() {
  const toast = useToast()
  const { updatePassword } = useAuth()
  const [password, setPassword] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const problem = passwordProblem(password)

  return (
    <Card className="p-4">
      <h2 className="text-[15px] font-semibold tracking-tight">Password</h2>
      <input
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="New password"
        className="mt-2 h-11 w-full rounded-xl bg-sunken px-3 text-[15px] outline-none"
      />
      <p className="mt-1 text-[12px] text-ink-muted">
        {password.length === 0 ? 'Set or change your password.' : (problem ?? 'Strong enough.')}
      </p>
      <Button
        variant="secondary"
        className="mt-2 w-full"
        disabled={!isValidPassword(password) || isBusy}
        onClick={() => {
          setIsBusy(true)
          void updatePassword(password)
            .then(() => {
              setPassword('')
              toast.show('Password updated')
            })
            .catch((error: unknown) =>
              toast.show(error instanceof Error ? error.message : 'Could not update password'),
            )
            .finally(() => setIsBusy(false))
        }}
      >
        Update password
      </Button>
    </Card>
  )
}
