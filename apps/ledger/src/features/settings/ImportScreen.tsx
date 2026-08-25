// Import transactions from a bank's exported CSV or OFX/QFX — the free path that needs
// no aggregator. Parses client-side, previews the count, and imports as deduped manual
// entries (rules then auto-categorize them).

import { useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@tracker-engine/ui'
import { SubScreen } from '@/components/SubScreen'
import { Money } from '@/components/Money'
import * as repo from '@/data/repository'
import { parseStatement, type ParseResult } from '@/lib/import'

type Stage =
  | { kind: 'idle' }
  | { kind: 'parsed'; filename: string; result: ParseResult }
  | { kind: 'done'; added: number; skipped: number }

export function ImportScreen({ onBack }: { onBack: () => void }) {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)

  async function onFile(file: File) {
    const text = await file.text()
    setStage({ kind: 'parsed', filename: file.name, result: parseStatement(file.name, text) })
  }

  async function doImport() {
    if (stage.kind !== 'parsed') return
    setBusy(true)
    const { added, skipped } = await repo.importEntries(stage.result.rows)
    setBusy(false)
    setStage({ kind: 'done', added, skipped })
  }

  return (
    <SubScreen title="Import transactions" onBack={onBack}>
      <div className="px-4">
        <p className="mb-4 text-sm text-ink-muted">
          Export a CSV or OFX/QFX statement from your bank and import it here — free, no
          bank connection needed. Duplicates are skipped automatically.
        </p>

        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-line bg-surface px-6 py-8 text-center active:bg-sunken">
          <Upload size={24} className="text-ink-muted" />
          <span className="text-sm font-medium text-ink">Choose a .csv or .ofx file</span>
          <input
            type="file"
            accept=".csv,.ofx,.qfx,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void onFile(file)
            }}
          />
        </label>

        {stage.kind === 'parsed' && (
          <div className="mt-4 rounded-2xl border border-line bg-surface p-4">
            <div className="text-sm text-ink">
              <b>{stage.filename}</b> · {stage.result.format.toUpperCase()}
            </div>
            {stage.result.warnings.length > 0 ? (
              <p className="mt-2 text-sm text-critical">{stage.result.warnings.join(' ')}</p>
            ) : (
              <>
                <p className="mt-1 text-sm text-ink-muted">
                  {stage.result.rows.length} transactions found.
                </p>
                <div className="mt-3 max-h-56 divide-y divide-line overflow-y-auto rounded-xl border border-line">
                  {stage.result.rows.slice(0, 8).map((r, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span className="truncate text-ink">
                        <span className="text-ink-muted">{r.date}</span> {r.merchant}
                      </span>
                      <Money minor={r.amountMinor} className="ml-2 shrink-0" />
                    </div>
                  ))}
                </div>
                <Button className="mt-3 w-full" onClick={doImport} disabled={busy || stage.result.rows.length === 0}>
                  {busy ? 'Importing…' : `Import ${stage.result.rows.length} transactions`}
                </Button>
              </>
            )}
          </div>
        )}

        {stage.kind === 'done' && (
          <div className="mt-4 rounded-2xl border border-line bg-surface p-4 text-center">
            <p className="text-lg font-semibold text-ink">Imported {stage.added}</p>
            <p className="mt-1 text-sm text-ink-muted">
              {stage.skipped > 0 ? `${stage.skipped} duplicates skipped. ` : ''}
              They're in your ledger and categorized by your rules.
            </p>
            <Button variant="secondary" className="mt-3" onClick={() => setStage({ kind: 'idle' })}>
              Import another
            </Button>
          </div>
        )}
      </div>
    </SubScreen>
  )
}
