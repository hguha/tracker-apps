import { fmtMoney } from '@/lib/format'
import { cn } from '@/lib/cn'

// A signed amount, tabular-aligned. Income (positive) reads green; spend stays ink so
// a statement isn't a wall of red. `colorize={false}` for neutral contexts (totals).
export function Money({
  minor,
  currency = 'USD',
  colorize = true,
  signDisplay = 'auto',
  className,
}: {
  minor: number
  currency?: string
  colorize?: boolean
  signDisplay?: 'auto' | 'always' | 'never'
  className?: string
}) {
  return (
    <span
      className={cn(
        'tabular-nums',
        colorize && minor > 0 && 'text-pos',
        className,
      )}
    >
      {fmtMoney(minor, currency, { signDisplay })}
    </span>
  )
}
