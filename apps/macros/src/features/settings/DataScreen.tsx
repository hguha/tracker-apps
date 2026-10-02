import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, Download, RefreshCw, Upload } from 'lucide-react'
import { Button, Card, useToast } from '@tracker-engine/ui'
import { exportBackup, pickBackupText } from '@tracker-engine/platform'
import { APP_VERSION } from '@/lib/version'
import { loadDemoData } from '@/data/demo'
import * as repo from '@/data/repository'
import { useSync } from '@/sync/useSync'
import {
  BackupParseError,
  countsOf,
  exportToCsv,
  exportToJson,
  importBackup,
  parseBackup,
} from '@/data/backup'

export function DataScreen({ onBack }: { onBack: () => void }) {
  const toast = useToast()
  const sync = useSync()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isBusy, setIsBusy] = useState(false)

  const counts = useLiveQuery(
    async () => ({ days: await repo.countLoggedDays(), weights: (await repo.weights()).length }),
    [],
  )

  async function handleImport(file?: File) {
    setIsBusy(true)
    try {
      const text = await pickBackupText(file)
      if (text === null) return
      const backup = parseBackup(text)
      const found = countsOf(backup)
      const ok = window.confirm(
        `Import ${found.entries} entries across ${found.days} days, ${found.weights} weigh-ins ` +
          `and ${found.recipes} recipes? Existing rows with the same id are overwritten; nothing is deleted.`,
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
      setIsBusy(false)
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
        <h1 className="flex-1 text-[16px] font-semibold tracking-tight">Data &amp; sync</h1>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <Card className="p-4">
          <h2 className="text-[15px] font-semibold tracking-tight">Status</h2>
          <dl className="mt-2 space-y-1.5 text-[13.5px]">
            <Row label="Days logged">{counts?.days ?? '—'}</Row>
            <Row label="Weigh-ins">{counts?.weights ?? '—'}</Row>
            <Row label="Queued for sync">{sync.pending}</Row>
            {sync.deadLettered > 0 && <Row label="Failed to sync">{sync.deadLettered}</Row>}
            <Row label="Sync">
              {sync.enabled ? 'On — syncs to your account' : 'This device only'}
            </Row>
            <Row label="App version">{APP_VERSION}</Row>
          </dl>

          {sync.enabled && (
            <Button
              variant="secondary"
              className="mt-3 w-full"
              disabled={sync.phase === 'syncing'}
              onClick={() => void sync.syncNow().then(() => toast.show('Synced'))}
            >
              <RefreshCw size={16} />
              {sync.phase === 'syncing' ? 'Syncing…' : 'Sync now'}
            </Button>
          )}
          {!sync.enabled && (
            <p className="mt-2 text-[12.5px] text-ink-muted">
              Everything stays on this device. Food lookups still work — only your own data
              stays local.
            </p>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="text-[15px] font-semibold tracking-tight">Backup</h2>
          <div className="mt-2 flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              disabled={isBusy}
              onClick={() => {
                void exportToJson()
                  .then((json) =>
                    exportBackup(json, `macrocosm-${new Date().toISOString().slice(0, 10)}.json`),
                  )
                  .then((shared) => shared && toast.show('Backup saved'))
              }}
            >
              <Download size={16} />
              Export
            </Button>
            <Button
              variant="secondary"
              className="flex-1"
              disabled={isBusy}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={16} />
              Import
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(event) => void handleImport(event.target.files?.[0])}
          />
          <p className="mt-2 text-[12.5px] text-ink-muted">
            A JSON copy of your logs, weigh-ins, recipes and check-ins. Foods aren't included —
            they're reference data the app can re-fetch.
          </p>

          <Button
            variant="secondary"
            className="mt-2 w-full"
            disabled={isBusy}
            onClick={() => {
              void exportToCsv()
                .then((csv) =>
                  exportBackup(
                    csv,
                    `macrocosm-log-${new Date().toISOString().slice(0, 10)}.csv`,
                    'Food log',
                  ),
                )
                .then((shared) => shared && toast.show('CSV saved'))
            }}
          >
            <Download size={16} />
            Export a spreadsheet (CSV)
          </Button>
          <p className="mt-1.5 text-[12px] text-ink-muted">
            One row per item with names, grams and macros — for reading, not restoring. The JSON
            export is the one that can be imported back.
          </p>
        </Card>

        {import.meta.env.DEV && (
          <Card className="p-4">
            <h2 className="text-[15px] font-semibold tracking-tight">Demo data</h2>
            <p className="mt-1 text-[12.5px] text-ink-muted">
              Five weeks of logs and weigh-ins with a real deficit, gaps included, so every screen
              has something to show. Written through the normal paths, so it syncs and is editable
              like anything else.
            </p>
            <Button
              variant="secondary"
              className="mt-2 w-full"
              disabled={isBusy}
              onClick={() => {
                setIsBusy(true)
                void loadDemoData()
                  .then(({ days, entries }) => {
                    toast.show(`Loaded ${entries} entries across ${days} days`)
                    window.location.reload()
                  })
                  .catch(() => toast.show('Could not load the demo data'))
                  .finally(() => setIsBusy(false))
              }}
            >
              {isBusy ? 'Loading…' : 'Load demo data'}
            </Button>
          </Card>
        )}

        <Card className="p-4">
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => void repo.saveProfile({ onboardingVersion: 0 })}
          >
            Replay setup
          </Button>
        </Card>

        <Card className="p-4">
          <h2 className="text-[15px] font-semibold tracking-tight">Reset</h2>
          <button
            onClick={() => {
              if (!window.confirm('Clear this device’s copy? Synced data can be pulled back.')) {
                return
              }
              void repo.clearLocalData().then(() => window.location.reload())
            }}
            className="mt-2 w-full py-2 text-[14px] font-semibold active:opacity-60"
            style={{ color: 'var(--status-critical)' }}
          >
            Clear local data on this device
          </button>
        </Card>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-secondary">{label}</dt>
      <dd className="tabular font-semibold">{children}</dd>
    </div>
  )
}
