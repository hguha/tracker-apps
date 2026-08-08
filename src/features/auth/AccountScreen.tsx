/**
 * Account settings (§11.1.2).
 *
 * Two pieces of deliberate friction here, both load-bearing:
 *
 *   - **Sign-out is blocked while the outbox has pending writes.** Signing out
 *     with unsynced sets would strand them, so the dialog says how many and
 *     offers to wait rather than silently losing a workout.
 *   - **Delete requires typing the word.** It is irreversible and takes years of
 *     data with it, so a mis-tap must not be sufficient.
 */

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, Check, ChevronLeft, LogIn, LogOut, Trash2 } from 'lucide-react'
import { db } from '@/db/database'
import { useAuth } from '@/auth/AuthContext'
import { isBackendConfigured } from '@/sync/supabaseClient'
import { initialsOf } from '@/auth/types'
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
  /** Start the device-only → real-account upgrade (keeps local data). */
  onConnectAccount?: () => void
}) {
  const { session, signOut, updateDisplayName, deleteAccount } = useAuth()
  const toast = useToast()

  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'none' | 'sign-out' | 'delete'>('none')
  const [deleteConfirmation, setDeleteConfirmation] = useState('')

  const stats = useLiveQuery(async () => {
    const workouts = await db.workouts.toArray()
    return {
      pendingWrites: await db.outbox.count(),
      workoutCount: workouts.filter((w) => w.endedAt !== null && w.deletedAt === null)
        .length,
      setCount: await db.sets.count(),
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
            <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-accent text-[19px] font-bold text-white">
              {initialsOf(session.displayName)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[17px] font-semibold">{session.displayName}</p>
              <p className="truncate text-[13px] text-ink-muted">
                {session.isVerified ? session.email : 'This device only'}
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

        {/* Shown while no server is attached, whichever way they signed in —
            the data is local either way, and saying otherwise would mislead. */}
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

        <Card className="p-4">
          <h2 className="text-[15px] font-semibold tracking-tight">Your data</h2>
          <dl className="mt-2.5 space-y-1.5 text-[13.5px]">
            <Row label="Member since" value={formatRelativeDay(session.createdAt)} />
            <Row label="Workouts logged" value={String(stats?.workoutCount ?? 0)} />
            <Row label="Sets recorded" value={String(stats?.setCount ?? 0)} />
            <Row
              label="Waiting to sync"
              value={
                hasPendingWrites ? `${stats?.pendingWrites} changes` : 'Nothing pending'
              }
            />
          </dl>
        </Card>

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
          isConfirmDisabled={deleteConfirmation.trim().toLowerCase() !== 'delete'}
          onConfirm={() => {
            void deleteAccount()
            toast.show('Account deleted')
          }}
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-secondary">{label}</dt>
      <dd className="font-semibold">{value}</dd>
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
