/**
 * Sync status, backups, and the destructive resets.
 *
 * Deliberately its own screen, and the only one with an irreversible control on
 * it. These used to sit at the bottom of the Me tab, which meant scrolling past
 * "Permanently erase all my training data" to reach the rest-timer default — the
 * two least-alike things in the app, adjacent. Anything that can't be undone
 * should take a deliberate navigation to reach.
 */

import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, Download, RefreshCw, Upload } from 'lucide-react'
import { db } from '@/db/database'
import * as repo from '@/data/repository'
import {
  backupFilename,
  countsOf,
  exportToJson,
  importBackup,
  parseBackup,
  BackupParseError,
} from '@/data/backup'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { useToast } from '@/components/Toast'
import { useSync } from '@/sync/useSync'

export function DataScreen({ onBack }: { onBack: () => void }) {
  const toast = useToast()
  const sync = useSync()
  const [isClearing, setIsClearing] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // The reason the most recent write was rejected, so "Failed to sync" explains
  // itself (e.g. an RLS or missing-column error) instead of being opaque.
  const lastSyncError = useLiveQuery(async () => {
    const last = await db.deadLetter.orderBy('seq').last()
    return last?.error ?? null
  }, [])

  const workoutCount = useLiveQuery(
    async () => (await repo.listWorkouts(500)).filter((w) => w.endedAt !== null).length,
    [],
  )

  async function handleExport() {
    if (isExporting) return
    setIsExporting(true)
    try {
      const json = await exportToJson()
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      // A sortable date stamp; toISOString is UTC but fine for a filename.
      link.download = backupFilename(new Date().toISOString().slice(0, 10))
      link.click()
      URL.revokeObjectURL(url)
      toast.show('Backup downloaded')
    } catch {
      toast.show('Could not export')
    } finally {
      setIsExporting(false)
    }
  }

  async function handleImportFile(file: File) {
    setIsImporting(true)
    try {
      const backup = parseBackup(await file.text())
      const counts = countsOf(backup)
      const ok = window.confirm(
        `Import ${counts.workouts} workouts, ${counts.templates} templates, ` +
          `${counts.exercises} custom exercises, and ${counts.metricEntries} measurements? ` +
          `Existing items with the same id are overwritten; nothing is deleted.`,
      )
      if (!ok) return
      await importBackup(backup)
      toast.show('Backup imported')
      // A hard reload is the simplest way to refresh every live query at once.
      window.location.reload()
    } catch (error) {
      toast.show(
        error instanceof BackupParseError ? error.message : 'Could not import that file',
      )
    } finally {
      setIsImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-1 border-b border-line bg-surface px-2 py-2 pt-safe">
        <button
          onClick={onBack}
          aria-label="Back"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-secondary active:bg-sunken"
        >
          <ChevronLeft size={22} />
        </button>
        <h1 className="flex-1 text-[16px] font-semibold tracking-tight">
          Data &amp; sync
        </h1>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <Card className="p-4">
          <h2 className="text-[15px] font-semibold tracking-tight">Status</h2>
          <dl className="mt-2.5 space-y-1.5 text-[13.5px]">
            <div className="flex justify-between">
              <dt className="text-ink-secondary">Workouts logged</dt>
              <dd className="tabular font-semibold">{workoutCount ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-secondary">Queued for sync</dt>
              <dd className="tabular font-semibold">{sync.pending}</dd>
            </div>
            {sync.deferred > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-secondary">Held until you finish</dt>
                <dd className="tabular font-semibold">{sync.deferred}</dd>
              </div>
            )}
            {sync.deadLettered > 0 && (
              <>
                <div className="flex justify-between">
                  <dt style={{ color: 'var(--status-serious)' }}>Failed to sync</dt>
                  <dd
                    className="tabular font-semibold"
                    style={{ color: 'var(--status-serious)' }}
                  >
                    {sync.deadLettered}
                  </dd>
                </div>
                {lastSyncError && (
                  <p className="text-[12px] text-ink-muted">Reason: {lastSyncError}</p>
                )}
              </>
            )}
            <div className="flex justify-between">
              <dt className="text-ink-secondary">Sync</dt>
              <dd className="font-semibold">
                {sync.enabled ? 'On — syncs to your account' : 'This device only'}
              </dd>
            </div>
          </dl>

          {sync.enabled ? (
            <>
              <Button
                variant="secondary"
                className="mt-3 w-full"
                disabled={sync.phase === 'syncing'}
                onClick={() => {
                  void sync.syncNow().then(() => {
                    toast.show(
                      sync.pending === 0 ? 'Everything is synced' : 'Sync finished',
                    )
                  })
                }}
              >
                <RefreshCw
                  size={16}
                  className={sync.phase === 'syncing' ? 'animate-spin' : undefined}
                />
                {sync.phase === 'syncing'
                  ? 'Syncing…'
                  : sync.pending > 0
                    ? `Sync now (${sync.pending} pending)`
                    : 'Sync now'}
              </Button>
              {sync.deadLettered > 0 && (
                <Button
                  variant="secondary"
                  className="mt-2 w-full"
                  disabled={sync.phase === 'syncing'}
                  onClick={() => {
                    void sync.retryFailed().then((count) => {
                      toast.show(
                        count > 0
                          ? `Retrying ${count} failed ${count === 1 ? 'change' : 'changes'}…`
                          : 'Nothing to retry',
                      )
                    })
                  }}
                >
                  <RefreshCw size={16} />
                  Retry {sync.deadLettered} failed
                </Button>
              )}
              {/* The escape hatch for a diverged device: concede to the server
                  instead of insisting the local copy wins. */}
              <button
                onClick={() => {
                  if (sync.phase === 'syncing') return
                  const ok = window.confirm(
                    `Discard ${sync.pending > 0 ? `${sync.pending} unsynced local change${sync.pending === 1 ? '' : 's'}` : 'unsynced local changes'} and load the server's version instead? Anything not yet synced from this device is lost.`,
                  )
                  if (!ok) return
                  void sync.discardLocalChanges().then(({ discarded, applied }) => {
                    toast.show(
                      `Discarded ${discarded} local change${discarded === 1 ? '' : 's'} · loaded ${applied} rows`,
                    )
                  })
                }}
                disabled={sync.phase === 'syncing'}
                className="mt-2 w-full py-2 text-[13px] font-semibold text-ink-secondary active:opacity-60 disabled:opacity-40"
              >
                Discard local changes &amp; use the server's copy
              </button>

              <p className="mt-2.5 text-[12px] text-ink-muted">
                Changes save on this device instantly and upload as you make them — a
                workout in progress is held back until you finish it. “Sync now” pushes
                and re-checks the server immediately.
                {sync.deadLettered > 0 &&
                  ' “Retry failed” re-attempts changes that were rejected — use it after a connection or server issue is resolved.'}
              </p>
            </>
          ) : (
            <p className="mt-2.5 text-[12px] text-ink-muted">
              This account keeps everything in this browser. Nothing is uploaded.
            </p>
          )}
        </Card>

        {/* Export / import: the portable backup that makes depending on a free
            tier acceptable (§11.3). Pure client-side JSON. */}
        <Card className="p-4">
          <h2 className="text-[15px] font-semibold tracking-tight">Backup</h2>
          <div className="mt-3 flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              disabled={isExporting}
              onClick={() => void handleExport()}
            >
              <Download size={16} />
              {isExporting ? 'Exporting…' : 'Export'}
            </Button>
            <Button
              variant="secondary"
              className="flex-1"
              disabled={isImporting}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={16} />
              {isImporting ? 'Importing…' : 'Import'}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void handleImportFile(file)
              }}
            />
          </div>
          <p className="mt-2 text-[12px] text-ink-muted">
            Export a full JSON backup of your workouts, templates, custom exercises, and
            measurements — or import one to restore or move devices.
          </p>
        </Card>

        <Card className="p-4">
          <h2 className="text-[15px] font-semibold tracking-tight">Reset</h2>
          <p className="mt-0.5 text-[12px] text-ink-muted">
            Export first if you want a copy — the last two cannot be undone.
          </p>

          {/* Removes finished sessions that contain no completed set — pulled from
              an older build, or left by an interrupted session. */}
          <button
            onClick={() => {
              if (isClearing) return
              setIsClearing(true)
              void repo
                .purgeEmptyWorkouts()
                .then((removed) => {
                  setIsClearing(false)
                  toast.show(
                    removed === 0
                      ? 'No empty workouts found'
                      : `Removed ${removed} empty ${removed === 1 ? 'workout' : 'workouts'}`,
                  )
                })
                .catch(() => {
                  setIsClearing(false)
                  toast.show('Could not remove empty workouts')
                })
            }}
            disabled={isClearing}
            className="mt-3 w-full py-2 text-[13px] font-semibold text-ink-secondary active:opacity-60 disabled:opacity-40"
          >
            Remove empty workouts
          </button>

          {/* Clears IndexedDB. On a synced account the next pull rehydrates from
              the server; on an offline account this is a genuine reset. */}
          <button
            onClick={() => {
              if (isClearing) return
              const ok = window.confirm(
                sync.enabled
                  ? 'Clear this device’s local copy? Your data stays on the server and will re-download on the next sync.'
                  : 'Clear all local data on this device? This cannot be undone — export first if you want a copy.',
              )
              if (!ok) return
              setIsClearing(true)
              void repo
                .clearLocalData()
                .then(() => window.location.reload())
                .catch(() => {
                  setIsClearing(false)
                  toast.show('Could not clear data')
                })
            }}
            disabled={isClearing}
            className="mt-1 w-full py-2 text-[13px] font-semibold text-critical active:opacity-60 disabled:opacity-40"
          >
            {isClearing ? 'Clearing…' : 'Clear local data on this device'}
          </button>

          {/* The real reset. On a synced account this physically DELETEs the rows
              server-side (a tombstone would leave every row in Postgres), then
              wipes the local copy. Offline, the local wipe is the whole story. */}
          <button
            onClick={() => {
              if (isClearing) return
              const ok = window.confirm(
                sync.enabled
                  ? 'Permanently erase ALL workouts, templates, custom exercises, and measurements — from this device AND the server, on every device? The rows are deleted outright, not hidden. This cannot be undone. Export first if you want a copy.'
                  : 'Permanently erase ALL workouts, templates, custom exercises, and measurements? This cannot be undone. Export first if you want a copy.',
              )
              if (!ok) return
              setIsClearing(true)
              void (async () => {
                try {
                  // Server first: erase the rows outright. Doing this before the
                  // local wipe means a failure here leaves local data intact to
                  // retry from, rather than losing it with the server still full.
                  if (sync.enabled) {
                    const { failed } = await sync.eraseServerData()
                    if (failed.length > 0) {
                      setIsClearing(false)
                      toast.show(
                        `Could not erase ${failed.map((f) => f.table).join(', ')} on the server — nothing was deleted locally`,
                      )
                      return
                    }
                  }
                  // Then the local copy. Cursors were reset above, so the next
                  // pull sees an empty server rather than rehydrating.
                  await repo.clearLocalData()
                  window.location.reload()
                } catch {
                  setIsClearing(false)
                  toast.show('Could not erase training data')
                }
              })()
            }}
            disabled={isClearing}
            className="mt-1 w-full py-2 text-[13px] font-semibold text-critical active:opacity-60 disabled:opacity-40"
          >
            {isClearing ? 'Erasing…' : 'Permanently erase all my training data'}
          </button>
        </Card>

        <div className="h-4" />
      </div>
    </div>
  )
}
