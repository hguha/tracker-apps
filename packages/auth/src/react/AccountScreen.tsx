import { useState, type ReactNode } from 'react'
import { AlertTriangle, Check, KeyRound, LogIn, LogOut, Trash2 } from 'lucide-react'
import { formatRelativeDay, plural } from '@tracker-engine/core'
import { BottomSheet, Button, Card, Screen, useToast } from '@tracker-engine/ui'
import { isBackendConfigured } from '../client'
import { initialsOf, passwordProblem } from '../types'
import type { Session } from '../types'

export interface AccountActions {
  session: Session | null | undefined
  signOut(): Promise<void>
  updateDisplayName(name: string): Promise<void>
  updatePassword(password: string): Promise<void>
  deleteAccount(): Promise<void>
}

export interface AccountScreenProps {
  auth: AccountActions
  onBack: () => void
  onConnectAccount?: () => void
  unsyncedChanges: number
  whatIsErased: string
  nameHint: string
  privacyUrl: string
  onRenamed?: (name: string) => Promise<void>
  onDeleted: () => Promise<void>
}

const FIELD =
  'h-11 w-full rounded-xl bg-sunken px-3.5 text-[16px] outline-none focus:ring-2 focus:ring-accent/40'
const LABEL = 'mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-ink-muted'

export function AccountScreen({
  auth,
  onBack,
  onConnectAccount,
  unsyncedChanges,
  whatIsErased,
  nameHint,
  privacyUrl,
  onRenamed,
  onDeleted,
}: AccountScreenProps) {
  const toast = useToast()
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'none' | 'sign-out' | 'delete'>('none')
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const session = auth.session
  if (!session) return null

  const name = nameDraft ?? session.displayName
  const canConnect = isBackendConfigured() && onConnectAccount !== undefined

  async function commitName() {
    const trimmed = name.trim()
    if (trimmed && trimmed !== session!.displayName) {
      await auth.updateDisplayName(trimmed)
      await onRenamed?.(trimmed)
      toast.show('Name updated')
    }
    setNameDraft(null)
  }

  async function confirmDelete() {
    setIsDeleting(true)
    try {
      await auth.deleteAccount()
      await onDeleted()
      toast.show(session!.isLocal ? 'This device was erased' : 'Account deleted')
    } catch (cause) {
      toast.show(
        cause instanceof Error
          ? `Could not delete the account: ${cause.message}`
          : 'Could not delete the account. Try again.',
      )
    } finally {
      setDialog('none')
      setDeleteConfirmation('')
      setIsDeleting(false)
    }
  }

  return (
    <Screen title="Account" onBack={onBack}>
      <Card className="p-4">
        <div className="flex items-center gap-3.5">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-accent text-[19px] font-bold text-accent-contrast">
            {initialsOf(session.displayName)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] font-semibold">{session.displayName}</p>
            <p className="truncate text-[13px] text-ink-muted">
              {session.isLocal ? 'This device only' : session.email}
            </p>
            <p className="truncate text-[12px] text-ink-muted">
              Member since {formatRelativeDay(session.createdAt)}
            </p>
          </div>
        </div>

        <label htmlFor="account-name" className={`${LABEL} mt-4`}>
          Display name
        </label>
        <div className="flex gap-2">
          <input
            id="account-name"
            value={name}
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={() => void commitName()}
            className={FIELD}
          />
          {nameDraft !== null && nameDraft.trim() !== session.displayName && (
            <Button variant="secondary" onClick={() => void commitName()} aria-label="Save name">
              <Check size={17} />
            </Button>
          )}
        </div>
        <p className="mt-1.5 text-[12px] text-ink-muted">{nameHint}</p>
      </Card>

      {!session.isLocal && <PasswordCard updatePassword={auth.updatePassword} />}

      {session.isLocal && (
        <Card className="p-4">
          <p className="flex items-start gap-2 text-[13px] text-ink-secondary">
            <AlertTriangle
              size={16}
              className="mt-0.5 shrink-0"
              style={{ color: 'var(--status-warning)' }}
            />
            <span>
              This account lives only in this browser. Clearing site data or switching devices
              loses everything.
              {isBackendConfigured()
                ? ' Connect an email account to sync across devices and back up — everything you’ve logged here comes with you.'
                : ' Sign in with email once the server is connected to sync and back up.'}
            </span>
          </p>
          {canConnect && (
            <Button variant="secondary" className="mt-3 w-full" onClick={onConnectAccount}>
              <LogIn size={16} />
              Connect an account &amp; sync
            </Button>
          )}
        </Card>
      )}

      <Card className="overflow-hidden">
        {!session.isLocal && (
          <button
            onClick={() => setDialog('sign-out')}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-sunken"
          >
            <LogOut size={18} className="shrink-0 text-ink-muted" />
            <span className="text-[15px] font-semibold">Sign out</span>
          </button>
        )}
        <button
          onClick={() => setDialog('delete')}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-sunken not-first:border-t not-first:border-line"
        >
          <Trash2 size={18} className="shrink-0 text-critical" />
          <span className="text-[15px] font-semibold text-critical">
            {session.isLocal ? 'Erase all data on this device' : 'Delete account'}
          </span>
        </button>
      </Card>

      <p className="px-1 pt-2 text-center text-[12px] text-ink-muted">
        <a
          href={privacyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-line-strong underline-offset-2 active:opacity-60"
        >
          Privacy policy
        </a>
      </p>

      {dialog === 'sign-out' && (
        <Dialog
          title="Sign out?"
          onDismiss={() => setDialog('none')}
          confirmLabel={unsyncedChanges > 0 ? 'Sign out anyway' : 'Sign out'}
          confirmVariant={unsyncedChanges > 0 ? 'danger' : 'primary'}
          onConfirm={() =>
            void auth.signOut().catch((error) => console.warn('[auth] sign-out failed', error))
          }
        >
          {unsyncedChanges > 0 ? (
            <p className="text-[14px] text-ink-secondary">
              <span className="font-semibold text-ink">
                {plural(unsyncedChanges, 'change')} haven’t synced yet.
              </span>{' '}
              They stay on this device and sync when you sign back in to this account. Signing
              in to a different account here, or using this device only, erases them.
            </p>
          ) : (
            <p className="text-[14px] text-ink-secondary">
              Everything is saved to your account. You can sign back in any time.
            </p>
          )}
        </Dialog>
      )}

      {dialog === 'delete' && (
        <Dialog
          title={session.isLocal ? 'Erase everything on this device?' : 'Delete your account?'}
          onDismiss={() => {
            setDialog('none')
            setDeleteConfirmation('')
          }}
          confirmLabel={isDeleting ? 'Deleting…' : 'Delete everything'}
          confirmVariant="danger"
          isConfirmDisabled={deleteConfirmation.trim().toLowerCase() !== 'delete' || isDeleting}
          onConfirm={() => void confirmDelete()}
        >
          <p className="text-[14px] text-ink-secondary">
            This removes <span className="font-semibold text-ink">{whatIsErased}</span>
            {session.isLocal ? ' from this device' : ', and your account with it'}. It cannot be
            undone.
          </p>
          <label
            htmlFor="account-delete-confirm"
            className="mt-3 block text-[13px] font-semibold text-ink-secondary"
          >
            Type <span className="font-bold text-ink">delete</span> to confirm.
          </label>
          <input
            id="account-delete-confirm"
            autoFocus
            value={deleteConfirmation}
            onChange={(event) => setDeleteConfirmation(event.target.value)}
            autoCapitalize="none"
            className="mt-1.5 h-11 w-full rounded-xl bg-sunken px-3.5 text-[16px] outline-none focus:ring-2 focus:ring-critical/40"
          />
        </Dialog>
      )}
    </Screen>
  )
}

function Dialog({
  title,
  children,
  confirmLabel,
  confirmVariant,
  isConfirmDisabled = false,
  onConfirm,
  onDismiss,
}: {
  title: string
  children: ReactNode
  confirmLabel: string
  confirmVariant: 'primary' | 'danger'
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

function PasswordCard({ updatePassword }: { updatePassword(password: string): Promise<void> }) {
  const toast = useToast()
  const [isOpen, setIsOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const problem = passwordProblem(password)

  const close = () => {
    setIsOpen(false)
    setPassword('')
    setError(null)
  }

  async function save() {
    if (problem !== null) return
    setIsBusy(true)
    setError(null)
    try {
      await updatePassword(password)
      close()
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
      <label htmlFor="account-password" className={LABEL}>
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
        className={FIELD}
      />
      <p className="mt-1.5 text-[12px] text-ink-muted">{problem ?? 'Looks good.'}</p>
      {error && (
        <p role="alert" className="mt-2 text-[13px] text-critical">
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={close}>
          Cancel
        </Button>
        <Button className="flex-1" disabled={problem !== null || isBusy} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </Card>
  )
}
