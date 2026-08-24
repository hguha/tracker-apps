import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'

// A pushed sub-screen with a back header — the settings sections and any drill-down.
export function SubScreen({
  title,
  onBack,
  children,
}: {
  title: string
  onBack: () => void
  children: ReactNode
}) {
  return (
    <div className="pb-6">
      <header className="flex items-center gap-3 px-4 pb-2 pt-3">
        <button onClick={onBack} aria-label="Back" className="text-ink-secondary">
          <ArrowLeft size={22} />
        </button>
        <h1 className="text-xl font-bold text-ink">{title}</h1>
      </header>
      {children}
    </div>
  )
}
