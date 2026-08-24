// The full ledger: every entry, newest first, grouped by month, with search and a
// category filter. Tapping a manual entry edits it; tapping a bank transaction opens
// the categorize sheet (its row is server-authored and can't be edited).

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { ScreenHeader } from '@/components/ScreenHeader'
import { TransactionRow } from '@/components/TransactionRow'
import { CategoryPickerSheet } from '@/components/CategoryPickerSheet'
import { EmptyState } from '@/components/EmptyState'
import * as repo from '@/data/repository'
import { monthKey, monthLabel } from '@/lib/dates'
import type { LedgerEntry } from '@/domain/types'
import { useLedgerData } from '@/features/shared/useLedgerData'

export function HistoryScreen({ onOpenEntry }: { onOpenEntry: (id: string) => void }) {
  const { entries, categories, categoryMap, loading } = useLedgerData()
  const [query, setQuery] = useState('')
  const [filterCat, setFilterCat] = useState<string | null>(null)
  const [categorizing, setCategorizing] = useState<LedgerEntry | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => {
      if (filterCat && (e.categoryId ?? 'uncategorized') !== filterCat) return false
      if (q && !e.merchant.toLowerCase().includes(q)) return false
      return true
    })
  }, [entries, query, filterCat])

  const groups = useMemo(() => {
    const byMonth = new Map<string, LedgerEntry[]>()
    for (const e of filtered) {
      const key = monthKey(e.date)
      const list = byMonth.get(key) ?? []
      list.push(e)
      byMonth.set(key, list)
    }
    return [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [filtered])

  if (loading) return null

  const handleRowTap = (entry: LedgerEntry) =>
    entry.source === 'manual' ? onOpenEntry(entry.id) : setCategorizing(entry)

  return (
    <div className="pb-6">
      <ScreenHeader title="History" subtitle={`${entries.length} transactions`} />

      <div className="px-4">
        <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3">
          <Search size={16} className="text-ink-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search merchant"
            className="h-11 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-muted"
          />
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          <FilterChip label="All" active={filterCat === null} onClick={() => setFilterCat(null)} />
          {categories.map((c) => (
            <FilterChip
              key={c.id}
              label={`${c.icon} ${c.name}`}
              active={filterCat === c.id}
              onClick={() => setFilterCat(filterCat === c.id ? null : c.id)}
            />
          ))}
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="px-4 pt-6">
          <EmptyState title="No matching transactions" hint="Try a different search or filter." />
        </div>
      ) : (
        groups.map(([month, list]) => (
          <section key={month} className="mt-4">
            <h2 className="px-4 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {monthLabel(month)}
            </h2>
            <div className="divide-y divide-line border-y border-line bg-surface">
              {list.map((entry) => (
                <TransactionRow
                  key={entry.id}
                  entry={entry}
                  category={entry.categoryId ? categoryMap.get(entry.categoryId) : undefined}
                  onTap={() => handleRowTap(entry)}
                />
              ))}
            </div>
          </section>
        ))
      )}

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

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={
        'shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-sm ' +
        (active ? 'bg-accent text-accent-contrast' : 'bg-sunken text-ink-secondary')
      }
    >
      {label}
    </button>
  )
}
