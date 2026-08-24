// The home surface: net worth, this month's cash flow at a glance, where the money's
// going, and a shortcut into the coach. Every number comes from the canonical metrics
// layer so it matches Insights exactly.

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@tracker-engine/ui'
import { ScreenHeader } from '@/components/ScreenHeader'
import { StatCard } from '@/components/StatCard'
import { Money } from '@/components/Money'
import { TransactionRow } from '@/components/TransactionRow'
import { CategoryPickerSheet } from '@/components/CategoryPickerSheet'
import { EmptyState } from '@/components/EmptyState'
import * as repo from '@/data/repository'
import * as metrics from '@/lib/metrics'
import { fmtAbs, fmtPercent } from '@/lib/format'
import { monthLabel } from '@/lib/dates'
import { UNCATEGORIZED_COLOR } from '@/domain/categories'
import type { LedgerEntry } from '@/domain/types'
import { useLedgerData } from '@/features/shared/useLedgerData'

export function OverviewScreen({
  onOpenEntry,
  onOpenCoach,
}: {
  onOpenEntry: (id: string) => void
  onOpenCoach: () => void
}) {
  const { accounts, entries, categories, categoryMap, currentMonth, currentEntries, loading } =
    useLedgerData()
  const [categorizing, setCategorizing] = useState<LedgerEntry | null>(null)

  if (loading) return null

  const netWorth = metrics.netWorthMinor(accounts)
  const { incomeMinor, spendMinor } = metrics.totals(currentEntries)
  const savings = metrics.savingsRate(currentEntries)
  const byCategory = metrics.spendingByCategory(currentEntries).slice(0, 4)
  const totalSpend = byCategory.reduce((s, c) => s + c.totalMinor, 0)
  const recent = entries.slice(0, 6)

  const handleRowTap = (entry: LedgerEntry) =>
    entry.source === 'manual' ? onOpenEntry(entry.id) : setCategorizing(entry)

  return (
    <div className="pb-6">
      <ScreenHeader
        title="Overview"
        subtitle={currentMonth ? monthLabel(currentMonth) : undefined}
        action={
          <Button size="sm" variant="secondary" onClick={onOpenCoach}>
            <Sparkles size={16} className="mr-1" /> Coach
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 px-4">
        <StatCard
          label="Net worth"
          value={<Money minor={netWorth} colorize={false} />}
          hint={`${accounts.length} accounts`}
          className="col-span-2"
        />
        <StatCard label="Income" tone="pos" value={<Money minor={incomeMinor} colorize={false} />} />
        <StatCard label="Spending" value={fmtAbs(spendMinor)} />
        <StatCard label="Savings rate" value={fmtPercent(savings)} hint="of income kept" />
        <StatCard
          label="Net this month"
          value={<Money minor={incomeMinor + spendMinor} />}
          tone={incomeMinor + spendMinor >= 0 ? 'pos' : 'neg'}
        />
      </div>

      <section className="mt-6 px-4">
        <h2 className="mb-2 text-sm font-semibold text-ink-muted">Top spending</h2>
        {byCategory.length === 0 ? (
          <EmptyState title="No spending yet this month" />
        ) : (
          <div className="rounded-2xl border border-line bg-surface p-4">
            {byCategory.map(({ categoryId, totalMinor }) => {
              const cat = categoryMap.get(categoryId)
              const share = totalSpend > 0 ? totalMinor / totalSpend : 0
              return (
                <div key={categoryId} className="mb-3 last:mb-0">
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-ink">{cat ? `${cat.icon} ${cat.name}` : 'Uncategorized'}</span>
                    <span className="tabular-nums text-ink-secondary">{fmtAbs(totalMinor)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.round(share * 100)}%`,
                        backgroundColor: cat?.color ?? UNCATEGORIZED_COLOR,
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-1 px-4 text-sm font-semibold text-ink-muted">Recent</h2>
        {recent.length === 0 ? (
          <div className="px-4">
            <EmptyState
              title="Nothing here yet"
              hint="Sync a bank account or log a transaction to get started."
            />
          </div>
        ) : (
          <div className="divide-y divide-line border-y border-line bg-surface">
            {recent.map((entry) => (
              <TransactionRow
                key={entry.id}
                entry={entry}
                category={entry.categoryId ? categoryMap.get(entry.categoryId) : undefined}
                onTap={() => handleRowTap(entry)}
              />
            ))}
          </div>
        )}
      </section>

      {categorizing && (
        <CategoryPickerSheet
          categories={categories}
          currentId={categorizing.categoryId}
          onPick={async (categoryId) => {
            await repo.setEntryCategory(categorizing, categoryId)
            setCategorizing(null)
          }}
          onClose={() => setCategorizing(null)}
        />
      )}
    </div>
  )
}
