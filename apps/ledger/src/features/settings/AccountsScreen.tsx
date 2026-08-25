// Bank accounts are server-authored (pulled from the aggregator), so they're read-only
// here. "Connect a bank" is the Plaid Link entry point — scaffolded (see sync/plaid.ts);
// until sandbox keys are wired it explains the seam rather than opening Link.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Landmark, Plus } from 'lucide-react'
import { Button } from '@tracker-engine/ui'
import { SubScreen } from '@/components/SubScreen'
import { EmptyState } from '@/components/EmptyState'
import { Money } from '@/components/Money'
import * as repo from '@/data/repository'
import * as metrics from '@/lib/metrics'

export function AccountsScreen({ onBack }: { onBack: () => void }) {
  const accounts = useLiveQuery(() => repo.listAccounts(), []) ?? []
  const [showConnect, setShowConnect] = useState(false)

  return (
    <SubScreen title="Bank accounts" onBack={onBack}>
      <div className="px-4">
        <div className="mb-4 rounded-2xl border border-line bg-surface p-4">
          <div className="text-xs uppercase tracking-wide text-ink-muted">Net worth</div>
          <div className="mt-1 text-2xl font-bold">
            <Money minor={metrics.netWorthMinor(accounts)} colorize={false} />
          </div>
        </div>

        {accounts.length === 0 ? (
          <EmptyState
            icon={<Landmark size={28} />}
            title="No accounts connected"
            hint="Connect a bank to pull balances and transactions automatically."
          />
        ) : (
          <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {accounts.map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex size-9 items-center justify-center rounded-full bg-sunken">
                  <Landmark size={16} className="text-ink-secondary" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-ink">{a.name}</div>
                  <div className="text-xs text-ink-muted">
                    {a.institution ?? a.type} ···· {a.mask}
                  </div>
                </div>
                <Money minor={a.currentBalanceMinor} colorize={false} className="font-semibold" />
              </div>
            ))}
          </div>
        )}

        <div className="mt-4">
          <Button variant="secondary" className="w-full" onClick={() => setShowConnect((v) => !v)}>
            <Plus size={16} className="mr-1" /> Connect a bank
          </Button>
        </div>

        {showConnect && (
          <div className="mt-3 rounded-2xl border border-line bg-surface p-4 text-sm text-ink-secondary">
            <p className="font-medium text-ink">Import is the free way in</p>
            <p className="mt-1">
              There's no free live-sync bank API anymore, so the free path is{' '}
              <b>Settings → Import transactions</b>: drop in a CSV/OFX export from any
              bank and it lands in your ledger, deduped and auto-categorized.
            </p>
            <p className="mt-2 text-ink-muted">
              Automatic live sync (Plaid/Stripe) is scaffolded server-side and can be
              switched on later — it's pay-as-you-go (pennies/month for personal use).
            </p>
          </div>
        )}
      </div>
    </SubScreen>
  )
}
