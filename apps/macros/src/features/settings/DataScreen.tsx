import { dayKey } from '@tracker-engine/core'
import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Download, RefreshCw, Upload } from 'lucide-react'
import { Button, Card, quietNextCelebrations, Screen, useToast } from '@tracker-engine/ui'
import { exportBackup, pickBackupText } from '@tracker-engine/platform'
import { APP_VERSION } from '@/lib/version'
import { loadDemoData } from '@/data/demo'
import * as repo from '@/data/repository'
import { useSyncStatus } from '@/sync/useSync'
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
  const sync = useSyncStatus()
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
      quietNextCelebrations()
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
    <Screen title="Data & sync" onBack={onBack}>
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
            onClick={() =>
              void sync
                .retryFailed()
                .then(({ isComplete }) =>
                  toast.show(isComplete ? 'Synced' : 'Some changes didn’t sync yet'),
                )
            }
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
                  exportBackup(json, `macrocosm-${dayKey(Date.now())}.json`),
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
          Logs, weigh-ins, recipes and check-ins as JSON.
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
                  `macrocosm-log-${dayKey(Date.now())}.csv`,
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
          One row per item, for reading. Only JSON can be imported.
        </p>
      </Card>

      {import.meta.env.DEV && (
        <Card className="p-4">
          <h2 className="text-[15px] font-semibold tracking-tight">Demo data</h2>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            Five weeks of sample logs and weigh-ins.
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
                  quietNextCelebrations()
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
            const warning = !sync.enabled
              ? 'Erase everything on this device? Nothing is stored anywhere else, so this cannot be undone.'
              : sync.pending > 0
                ? `Clear this device’s copy? ${sync.pending} unsynced ${sync.pending === 1 ? 'change is' : 'changes are'} lost; synced data comes back on the next sync.`
                : 'Clear this device’s copy? Synced data comes back on the next sync.'
            if (!window.confirm(warning)) {
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
    </Screen>
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
