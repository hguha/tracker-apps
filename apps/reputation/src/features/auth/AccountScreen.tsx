import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  KeyRound,
  LogIn,
  LogOut,
  Trash2,
} from 'lucide-react'
import { db, isReadyToPush } from '@/db/database'
import { clearDbOwner } from '@/db/owner'
import * as repo from '@/data/repository'
import { useAuth } from '@/auth/AuthContext'
import { isBackendConfigured } from '@/backend/supabaseClient'
import { initialsOf, passwordProblem } from '@/auth/types'
import { BottomSheet } from '@/components/BottomSheet'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { useToast } from '@/components/Toast'
import { formatRelativeDay } from '@/lib/dates'

export function AccountScreen({
  onBack,
  onConnectAccount,
}: {
  onBack: () => void
  onConnectAccount?: () => void
}) {
  const { session, signOut, updateDisplayName, deleteAccount } = useAuth()
  const toast = useToast()

  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'none' | 'sign-out' | 'delete'>('none')
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

  /**
   * Deletion has to be awaited and its failure surfaced: this used to fire and
   * forget, so a rejected call (or an undeployed function) still showed "Account
   * deleted" while the account lived on. On success the local database is cleared
   * too — the server rows are gone, and leaving a deleted account's history on the
   * device would resurface it on the next sign-in.
   */
  async function confirmDelete() {
    setIsDeleting(true)
    try {
      await deleteAccount()
      await repo.clearLocalData()
      clearDbOwner()
      setDialog('none')
      setDeleteConfirmation('')
      toast.show('Account deleted')
    } catch (cause) {
      setDialog('none')
      toast.show(
        cause instanceof Error
          ? `Could not delete the account: ${cause.message}`
          : 'Could not delete the account. Try again.',
      )
    } finally {
      setIsDeleting(false)
    }
  }

  // Account owns identity + account actions; counts and sync live on Data & sync.
  // Kept here only for the sign-out/delete safety checks, not shown as stats.
  const stats = useLiveQuery(async () => {
    const workouts = await db.workouts.toArray()
    return {
      // Held writes aren't counted: the user can't flush them until Finish.
      pendingWrites: (await db.outbox.toArray()).filter(isReadyToPush).length,
      workoutCount: workouts.filter((w) => w.endedAt !== null && w.deletedAt === null)
        .length,
    }
  }, [])

  if (!session) return null

  const hasPendingWrites = (stats?.pendingWrites ?? 0) > 0
  const name = nameDraft ?? session.displayName

  async function commitName() {
    const trimmed = name.trim()
    if (trimmed && trimmed !== session!.displayName) {
      await updateDisplayName(trimmed)
      toast.show('Name updated')
    }
    setNameDraft(null)
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-line bg-surface px-2 py-2 pt-safe">
        <button
          onClick={onBack}
          aria-label="Back"
          className="flex size-10 items-center justify-center rounded-lg text-ink-secondary active:bg-sunken"
        >
          <ChevronLeft size={22} />
        </button>
        <h1 className="flex-1 text-[16px] font-semibold tracking-tight">Account</h1>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <Card className="p-4">
          <div className="flex items-center gap-3.5">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-accent text-[19px] font-bold text-accent-contrast">
              {initialsOf(session.displayName)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[17px] font-semibold">{session.displayName}</p>
              <p className="truncate text-[13px] text-ink-muted">
                {session.isVerified ? session.email : 'This device only'}
              </p>
              <p className="truncate text-[12px] text-ink-muted">
                Member since {formatRelativeDay(session.createdAt)}
              </p>
            </div>
          </div>

          <label
            htmlFor="account-name"
            className="mb-1.5 mt-4 block text-[12px] font-semibold uppercase tracking-wide text-ink-muted"
          >
            Display name
          </label>
          <div className="flex gap-2">
            <input
              id="account-name"
              value={name}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={() => void commitName()}
              className="h-11 flex-1 rounded-xl border border-line bg-surface px-3.5 text-[16px] outline-none focus:border-accent"
            />
            {nameDraft !== null && nameDraft.trim() !== session.displayName && (
              <Button
                variant="secondary"
                onClick={() => void commitName()}
                aria-label="Save name"
              >
                <Check size={17} />
              </Button>
            )}
          </div>
          <p className="mt-1.5 text-[12px] text-ink-muted">
            Used for the greeting on Home.
          </p>
        </Card>

        {/* Only a real (server) account has a password to change. */}
        {!session.isLocal && <PasswordCard />}

        {session.isLocal && (
          <Card className="p-4">
            <p className="flex items-start gap-2 text-[13px] text-ink-secondary">
              <AlertTriangle
                size={16}
                className="mt-0.5 shrink-0"
                style={{ color: 'var(--status-warning)' }}
              />
              <span>
                This account lives only in this browser. Clearing site data or switching
                devices loses everything.
                {isBackendConfigured()
                  ? ' Connect an email account to sync across devices, back up your data, and unlock the AI coach — everything you’ve logged here comes with you.'
                  : ' Sign in with email once the server is connected to sync and back up.'}
              </span>
            </p>
            {isBackendConfigured() && onConnectAccount && (
              <Button
                variant="secondary"
                className="mt-3 w-full"
                onClick={onConnectAccount}
              >
                <LogIn size={16} />
                Connect an account &amp; sync
              </Button>
            )}
          </Card>
        )}

        <Card className="overflow-hidden">
          <button
            onClick={() => setDialog('sign-out')}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-sunken"
          >
            <LogOut size={18} className="shrink-0 text-ink-muted" />
            <span className="text-[15px] font-semibold">Sign out</span>
          </button>
          <button
            onClick={() => setDialog('delete')}
            className="flex w-full items-center gap-3 border-t border-line px-4 py-3.5 text-left active:bg-sunken"
          >
            <Trash2 size={18} className="shrink-0 text-critical" />
            <span className="text-[15px] font-semibold text-critical">
              Delete account
            </span>
          </button>
        </Card>

        <p className="px-1 pt-2 text-center text-[12px] text-ink-muted">
          <a
            href="https://reputation.fitness/app/privacy.html"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-line-strong underline-offset-2 active:opacity-60"
          >
            Privacy policy
          </a>
        </p>

        <div className="h-4" />
      </div>

      {dialog === 'sign-out' && (
        <Dialog
          title="Sign out?"
          onDismiss={() => setDialog('none')}
          confirmLabel={hasPendingWrites ? 'Sign out anyway' : 'Sign out'}
          confirmVariant={hasPendingWrites ? 'danger' : 'primary'}
          onConfirm={() => void signOut()}
        >
          {hasPendingWrites ? (
            <p className="text-[14px] text-ink-secondary">
              <span className="font-semibold text-ink">
                {stats?.pendingWrites} changes haven't synced yet.
              </span>{' '}
              Signing out now could lose them. Wait until you're online, or sign out
              anyway if you don't need them.
            </p>
          ) : (
            <p className="text-[14px] text-ink-secondary">
              Everything is saved. You can sign back in any time.
            </p>
          )}
        </Dialog>
      )}

      {dialog === 'delete' && (
        <Dialog
          title="Delete your account?"
          onDismiss={() => {
            setDialog('none')
            setDeleteConfirmation('')
          }}
          confirmLabel="Delete everything"
          confirmVariant="danger"
          isConfirmDisabled={
            deleteConfirmation.trim().toLowerCase() !== 'delete' || isDeleting
          }
          onConfirm={() => void confirmDelete()}
        >
          <p className="text-[14px] text-ink-secondary">
            This removes{' '}
            <span className="font-semibold text-ink">
              {stats?.workoutCount ?? 0} workouts
            </span>{' '}
            and every body measurement. It cannot be undone.
          </p>
          <p className="mt-3 text-[13px] font-semibold text-ink-secondary">
            Type <span className="font-bold text-ink">delete</span> to confirm.
          </p>
          <input
            autoFocus
            value={deleteConfirmation}
            onChange={(event) => setDeleteConfirmation(event.target.value)}
            autoCapitalize="none"
            className="mt-1.5 h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-[16px] outline-none focus:border-critical"
          />
        </Dialog>
      )}
    </div>
  )
}

function Dialog({
  title,
  children,
  confirmLabel,
  confirmVariant = 'primary',
  isConfirmDisabled = false,
  onConfirm,
  onDismiss,
}: {
  title: string
  children: React.ReactNode
  confirmLabel: string
  confirmVariant?: 'primary' | 'danger'
  isConfirmDisabled?: boolean
  onConfirm: () => void
  onDismiss: () => void
}) {
  return (
    <BottomSheet onDismiss={onDismiss} panelClassName="p-5">
      <h2 className="text-[19px] font-bold tracking-tight">{title}</h2>
      <div className="mt-2">{children}</div>
      <div className="mt-5 flex gap-2">
        <Button variant="secondary" size="lg" className="flex-1" onClick={onDismiss}>
          Cancel
        </Button>
        <Button
          variant={confirmVariant}
          size="lg"
          className="flex-1"
          disabled={isConfirmDisabled}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </BottomSheet>
  )
}

/**
 * Set or change the account password. Collapsed by default so it doesn't compete
 * with identity; a user who signed up with an emailed code has no password yet and
 * uses this to add one.
 */
function PasswordCard() {
  const { updatePassword } = useAuth()
  const toast = useToast()
  const [isOpen, setIsOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const problem = passwordProblem(password)

  async function save() {
    if (problem !== null) return
    setIsBusy(true)
    setError(null)
    try {
      await updatePassword(password)
      setPassword('')
      setIsOpen(false)
      toast.show('Password updated')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the password.')
    } finally {
      setIsBusy(false)
    }
  }

  if (!isOpen) {
    return (
      <Card className="overflow-hidden">
        <button
          onClick={() => setIsOpen(true)}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-sunken"
        >
          <KeyRound size={18} className="shrink-0 text-ink-muted" />
          <span className="text-[15px] font-semibold">Set or change password</span>
        </button>
      </Card>
    )
  }

  return (
    <Card className="p-4">
      <label
        htmlFor="account-password"
        className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-ink-muted"
      >
        New password
      </label>
      <input
        id="account-password"
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
        className="h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-[16px] outline-none focus:border-accent"
      />
      <p className="mt-1.5 text-[12px] text-ink-muted">{problem ?? 'Looks good.'}</p>
      {error && (
        <p role="alert" className="mt-2 text-[13px] text-critical">
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Button
          variant="secondary"
          className="flex-1"
          onClick={() => {
            setIsOpen(false)
            setPassword('')
            setError(null)
          }}
        >
          Cancel
        </Button>
        <Button
          className="flex-1"
          disabled={problem !== null || isBusy}
          onClick={() => void save()}
        >
          Save
        </Button>
      </div>
    </Card>
  )
}
