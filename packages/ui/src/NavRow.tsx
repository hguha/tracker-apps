import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card } from './Card'

/** A tappable row that pushes another screen. */
export function NavRow({
  icon,
  label,
  hint,
  onClick,
  tone,
}: {
  icon?: ReactNode
  label: string
  hint?: string
  onClick: () => void
  /** `warning` colours the hint, for "something needs your attention" without a second row. */
  tone?: 'warning'
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 border-b border-line px-4 py-3.5 text-left last:border-b-0 active:bg-sunken"
    >
      {icon && (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-wash text-accent">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] font-medium">{label}</span>
        {hint && (
          <span
            className="block truncate text-[12.5px] text-ink-muted"
            style={tone === 'warning' ? { color: 'var(--status-serious)' } : undefined}
          >
            {hint}
          </span>
        )}
      </span>
      <ChevronRight size={18} className="shrink-0 text-ink-muted" />
    </button>
  )
}

/** A group of `NavRow`s, with the card and dividers handled once. */
export function NavList({ children }: { children: ReactNode }) {
  return <Card className="overflow-hidden p-0">{children}</Card>
}
