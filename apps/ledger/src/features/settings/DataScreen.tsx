// Sync status and the data escape hatches (principle #6: always a discard-local and a
// hard-erase). Destructive actions confirm first. Delete-account runs the shared
// delete-account Edge Function via the auth provider.

import { useState } from 'react'
import { Button, useToast } from '@tracker-engine/ui'
import { SubScreen } from '@/components/SubScreen'
import { useAuth } from '@/auth/AuthContext'
import type { SyncStatus } from '@/sync/useSync'

export function DataScreen({ sync, onBack }: { sync: SyncStatus; onBack: () => void }) {
  const toast = useToast()
  const { session, deleteAccount } = useAuth()
  const [busy, setBusy] = useState(false)

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      toast.show(label)
    } finally {
      setBusy(false)
    }
  }

  const statusText = sync.isMock
    ? 'Demo mode — seeded bank feed, no server'
    : sync.enabled
      ? sync.phase === 'error'
        ? 'Last sync had trouble'
        : 'Synced'
      : 'Sign in to back up & sync'

  return (
    <SubScreen title="Sync & data" onBack={onBack}>
      <div className="mx-4 rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-center justify-between">
          <span className="text-ink">Status</span>
          <span className="text-sm text-ink-muted">{statusText}</span>
        </div>
        <div className="mt-2 flex items-center justify-between text-sm text-ink-muted">
          <span>Pending changes</span>
          <span className="tabular-nums">{sync.pending}</span>
        </div>
        {sync.deadLettered > 0 && (
          <div className="mt-1 flex items-center justify-between text-sm text-critical">
            <span>Failed writes</span>
            <span className="tabular-nums">{sync.deadLettered}</span>
          </div>
        )}
      </div>

      <div className="mt-4 space-y-2 px-4">
        <Button
          variant="secondary"
          className="w-full"
          disabled={!sync.enabled || busy}
          onClick={() => void run('Synced', sync.syncNow)}
        >
          Sync now
        </Button>
        {sync.deadLettered > 0 && (
          <Button
            variant="secondary"
            className="w-full"
            disabled={busy}
            onClick={() => void run('Retried failed writes', sync.retryFailed)}
          >
            Retry failed writes
          </Button>
        )}
        <Button
          variant="ghost"
          className="w-full"
          disabled={!sync.enabled || busy}
          onClick={() => {
            if (confirm('Discard local changes and re-pull from the server?')) {
              void run('Discarded local changes', sync.discardLocalChanges)
            }
          }}
        >
          Discard local changes
        </Button>
      </div>

      <div className="mt-8 px-4">
        <h2 className="mb-2 text-sm font-semibold text-critical">Danger zone</h2>
        <div className="space-y-2">
          <Button
            variant="danger"
            className="w-full"
            disabled={!sync.enabled || busy}
            onClick={() => {
              if (confirm('Erase all synced data from the server? This cannot be undone.')) {
                void run('Server data erased', sync.eraseServerData)
              }
            }}
          >
            Erase server data
          </Button>
          {session && !session.isLocal && (
            <Button
              variant="danger"
              className="w-full"
              disabled={busy}
              onClick={() => {
                if (confirm('Delete your account and all its data? This cannot be undone.')) {
                  void run('Account deleted', deleteAccount)
                }
              }}
            >
              Delete account
            </Button>
          )}
        </div>
      </div>
    </SubScreen>
  )
}
