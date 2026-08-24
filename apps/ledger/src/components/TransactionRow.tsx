import type { Category, LedgerEntry } from '@/domain/types'
import { fmtDate } from '@/lib/format'
import { cn } from '@/lib/cn'
import { CategoryBadge } from './CategoryBadge'
import { Money } from './Money'

// One ledger line. Tapping opens categorize/edit (the feature decides). A manual entry
// shows a small dot so it reads differently from bank-sourced rows.
export function TransactionRow({
  entry,
  category,
  onTap,
}: {
  entry: LedgerEntry
  category: Category | undefined
  onTap?: () => void
}) {
  return (
    <button
      onClick={onTap}
      disabled={!onTap}
      className={cn(
        'flex w-full items-center gap-3 px-4 py-2.5 text-left',
        onTap && 'active:bg-sunken',
      )}
    >
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-base"
        style={{ backgroundColor: 'var(--accent-wash)' }}
      >
        {category?.icon ?? '💸'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-medium text-ink">{entry.merchant}</span>
          {entry.source === 'manual' && (
            <span className="rounded bg-sunken px-1 text-[10px] text-ink-muted">manual</span>
          )}
          {entry.pending && (
            <span className="rounded bg-sunken px-1 text-[10px] text-ink-muted">pending</span>
          )}
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-xs text-ink-muted">
          <span>{fmtDate(entry.date)}</span>
          <CategoryBadge category={category} showLabel />
        </span>
      </span>
      <Money minor={entry.amountMinor} currency={entry.currency} className="font-semibold" />
    </button>
  )
}
