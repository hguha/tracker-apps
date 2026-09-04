// Sync status, backups, and the destructive resets — the only screen with an
// irreversible control, so it takes a deliberate navigation to reach.

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
import { isNativePlatform } from '@/lib/platform'
import { APP_VERSION } from '@/lib/version'
import { exportBackup, pickBackupText } from '@/platform/files'
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
  const [showQueue, setShowQueue] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Exactly what's waiting to upload, held, or rejected — so a stuck sync is
  // inspectable (and recoverable) rather than an opaque count.
  const queue = useLiveQuery(async () => {
    const outbox = await db.outbox.orderBy('seq').toArray()
    const dead = await db.deadLetter.orderBy('seq').toArray()
    return {
      pending: outbox.filter((e) => e.deferredForWorkoutId === undefined),
      held: outbox.filter((e) => e.deferredForWorkoutId !== undefined),
      failed: dead,
    }
  }, [])

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
      const filename = backupFilename(new Date().toISOString().slice(0, 10))
      // Native: OS share sheet. Web: a download. Same JSON either way.
      const shared = await exportBackup(json, filename)
      if (shared) toast.show('Backup saved')
    } catch {
      toast.show('Could not export')
    } finally {
      setIsExporting(false)
    }
  }

  async function handleImportFile(file?: File) {
    setIsImporting(true)
    try {
      const text = await pickBackupText(file)
      if (text === null) return
      const backup = parseBackup(text)
      const counts = countsOf(backup)
      const ok = window.confirm(
        `Import ${counts.workouts} workouts, ${counts.templates} templates, ` +
          `${counts.exercises} custom exercises, and ${counts.metricEntries} measurements? ` +
          `Existing items with the same id are overwritten; nothing is deleted.`,
      )
      if (!ok) return
      await importBackup(backup)
      toast.show('Backup imported')
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
            <div className="flex justify-between">
              <dt className="text-ink-secondary">App version</dt>
              <dd className="tabular font-semibold text-ink-muted">{APP_VERSION}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-secondary">Display</dt>
              <dd className="tabular text-right text-[12px] font-semibold text-ink-muted">
                {displayReport()}
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

        {queue && queue.pending.length + queue.held.length + queue.failed.length > 0 && (
          <Card className="p-4">
            <button
              onClick={() => setShowQueue((v) => !v)}
              className="flex w-full items-center justify-between text-left"
            >
              <h2 className="text-[15px] font-semibold tracking-tight">What's syncing</h2>
              <span className="text-[13px] font-semibold text-accent">
                {showQueue ? 'Hide' : 'Show'}
              </span>
            </button>
            {showQueue && (
              <div className="mt-3 space-y-3">
                <QueueGroup
                  label="Waiting to upload"
                  entries={queue.pending.map((e) => ({
                    key: String(e.seq),
                    heading: e.table,
                    // The retry state is what explains a row that isn't moving.
                    sub:
                      e.attempts > 0
                        ? `${e.rowId} · ${e.attempts} attempt(s): ${e.lastError ?? 'unknown error'}`
                        : e.rowId,
                    payload: null,
                  }))}
                />
                <QueueGroup
                  label="Held until you finish the workout"
                  entries={queue.held.map((e) => ({
                    key: String(e.seq),
                    heading: e.table,
                    sub: e.rowId,
                    payload: null,
                  }))}
                />
                <QueueGroup
                  label="Rejected"
                  tone="serious"
                  entries={queue.failed.map((e) => ({
                    key: String(e.seq),
                    heading: `${e.table} · ${e.attempts} attempt(s)`,
                    sub: e.error,
                    payload: e.row,
                  }))}
                />
                <p className="text-[12px] text-ink-muted">
                  These are the exact rows queued on this device. Use “Retry failed” above
                  once a connection or server issue is resolved, or export a backup first
                  if you want to keep a copy.
                </p>
              </div>
            )}
          </Card>
        )}

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
              onClick={() =>
                isNativePlatform()
                  ? void handleImportFile()
                  : fileInputRef.current?.click()
              }
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

function QueueGroup({
  label,
  entries,
  tone,
}: {
  label: string
  entries: { key: string; heading: string; sub: string; payload: unknown }[]
  tone?: 'serious'
}) {
  if (entries.length === 0) return null
  return (
    <div>
      <p
        className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide"
        style={{ color: tone === 'serious' ? 'var(--status-serious)' : undefined }}
      >
        {label} ({entries.length})
      </p>
      <div className="space-y-1.5">
        {entries.map((entry) => (
          <details key={entry.key} className="rounded-lg bg-sunken px-3 py-2">
            <summary className="cursor-pointer list-none text-[13px] font-medium">
              {entry.heading}
              <span className="ml-1.5 break-all text-[11.5px] font-normal text-ink-muted">
                {entry.sub}
              </span>
            </summary>
            {entry.payload !== null && (
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface p-2 text-[11px] leading-snug text-ink-secondary">
                {JSON.stringify(entry.payload, null, 2)}
              </pre>
            )}
          </details>
        ))}
      </div>
    </div>
  )
}

/**
 * What the OS actually tells us about the screen: the safe-area insets it reports,
 * the window height, and whether we're running installed. Shown because the iOS
 * safe-area behaviour differs between a browser tab, an installed web app and the
 * native shell, and guessing at which one is misreporting has cost several rounds
 * (docs/ios-safe-areas.md). Read as: top/bottom insets, window height, mode.
 */
function displayReport(): string {
  if (typeof window === 'undefined') return '—'
  const probe = document.createElement('div')
  // Resolve the env() values the same way the layout does, via a real element.
  probe.style.cssText =
    'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)'
  document.body.appendChild(probe)
  const style = getComputedStyle(probe)
  const top = Math.round(parseFloat(style.paddingTop) || 0)
  const bottom = Math.round(parseFloat(style.paddingBottom) || 0)
  probe.remove()

  // What the safe-area rules actually key off (main.tsx sets it), plus whether the
  // display-mode query agrees. They disagree on iOS: an installed web app sets
  // navigator.standalone but does not match the media query, which is why rules gated
  // on the query did nothing. Worth showing so that trap stays visible.
  const mode = document.documentElement.dataset.shell ?? 'unset'
  const dm = window.matchMedia('(display-mode: standalone)').matches ? 'dm✓' : 'dm✗'

  // The shell's own height next to the window's. These must match: a shell taller
  // than the visible area is what lets the document scroll its header off-screen.
  const shell = Math.round(document.documentElement.clientHeight)
  const visual = Math.round(window.visualViewport?.height ?? window.innerHeight)
  const mismatch = Math.abs(shell - visual) > 1 ? ` ⚠︎ shell ${shell}` : ''

  // What .pt-safe/.pb-safe actually resolve to, which is not the same as the reported
  // inset — the installed web app zeroes them because iOS has already inset it. This is
  // the number to check after a safe-area change.
  const pad = document.createElement('div')
  pad.className = 'pt-safe pb-safe'
  pad.style.cssText = 'position:fixed;visibility:hidden'
  document.body.appendChild(pad)
  const padStyle = getComputedStyle(pad)
  const padTop = Math.round(parseFloat(padStyle.paddingTop) || 0)
  const padBottom = Math.round(parseFloat(padStyle.paddingBottom) || 0)
  pad.remove()

  // Is the document itself scrolled or overflowing? That, not padding, is what can push
  // the whole app up past its own header — and it's the one thing the earlier readings
  // couldn't distinguish.
  const doc = document.documentElement
  const scrolled = Math.round(window.scrollY || doc.scrollTop || 0)
  const overflow = Math.round(doc.scrollHeight - doc.clientHeight)
  // Where the visual viewport sits relative to the layout viewport, and how the layout
  // viewport compares to the physical screen.
  const offsetTop = Math.round(window.visualViewport?.offsetTop ?? 0)
  const screenH = Math.round(window.screen?.height ?? 0)

  return [
    `inset ${top}/${bottom}`,
    `pad ${padTop}/${padBottom}`,
    `${visual}px${mismatch}`,
    `screen ${screenH}`,
    `scroll ${scrolled} over ${overflow} off ${offsetTop}`,
    `${mode} ${dm}`,
  ].join(' · ')
}
