import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * The back-and-title bar every pushed screen wears.
 *
 * `pt-safe` is here rather than at each call site because getting it wrong is invisible in a
 * browser and puts the title under the Dynamic Island on a phone — the one place a copy of this
 * markup per screen reliably goes wrong.
 */
export function ScreenHeader({
  title,
  onBack,
  action,
}: {
  title: string
  onBack: () => void
  action?: ReactNode
}) {
  return (
    <header className="flex items-center gap-1 border-b border-line bg-surface px-2 py-2 pt-safe">
      <button
        onClick={onBack}
        aria-label="Back"
        className="flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-secondary active:bg-sunken"
      >
        <ChevronLeft size={22} />
      </button>
      <h1 className="flex-1 truncate text-[16px] font-semibold tracking-tight">{title}</h1>
      {action}
    </header>
  )
}

/** A pushed screen: header, then a scrolling body. */
export function Screen({
  title,
  onBack,
  action,
  children,
}: {
  title: string
  onBack: () => void
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={title} onBack={onBack} action={action} />
      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3 pb-8">{children}</div>
    </div>
  )
}
