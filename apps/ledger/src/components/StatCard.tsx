import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

// A labelled hero number. Used across Overview and Insights so stats read the same
// everywhere.
export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
  className,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'default' | 'pos' | 'neg'
  className?: string
}) {
  return (
    <div className={cn('rounded-2xl border border-line bg-surface p-4', className)}>
      <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </div>
      <div
        className={cn(
          'mt-1 text-2xl font-bold tabular-nums',
          tone === 'pos' && 'text-pos',
          tone === 'neg' && 'text-neg',
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-ink-muted">{hint}</div>}
    </div>
  )
}
