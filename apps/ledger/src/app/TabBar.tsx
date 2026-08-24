// Bottom tab bar, matching REPutation: two tabs each side of a raised center action.
// The center action logs a transaction (the finance analogue of "log a workout").

import { BarChart3, Home, Plus, Receipt, Settings } from 'lucide-react'
import { cn } from '@/lib/cn'

export type TabKey = 'overview' | 'history' | 'insights' | 'settings'

type TabDefinition = { key: TabKey; label: string; icon: typeof Home }

const LEFT_TABS: TabDefinition[] = [
  { key: 'overview', label: 'Overview', icon: Home },
  { key: 'history', label: 'History', icon: Receipt },
]

const RIGHT_TABS: TabDefinition[] = [
  { key: 'insights', label: 'Insights', icon: BarChart3 },
  { key: 'settings', label: 'Settings', icon: Settings },
]

export function TabBar({
  active,
  onSelect,
  onLog,
}: {
  active: TabKey
  onSelect: (tab: TabKey) => void
  onLog: () => void
}) {
  return (
    <nav className="relative border-t border-line bg-surface pb-safe">
      <div className="flex items-stretch">
        {LEFT_TABS.map((tab) => (
          <TabButton key={tab.key} tab={tab} active={active} onSelect={onSelect} />
        ))}

        <div className="relative flex w-16 shrink-0 justify-center">
          <button
            onClick={onLog}
            aria-label="Log a transaction"
            className="relative z-10 -mt-4 flex size-14 items-center justify-center rounded-full bg-accent text-accent-contrast shadow-lg active:brightness-90"
          >
            <Plus size={26} strokeWidth={2.5} />
          </button>
        </div>

        {RIGHT_TABS.map((tab) => (
          <TabButton key={tab.key} tab={tab} active={active} onSelect={onSelect} />
        ))}
      </div>
    </nav>
  )
}

function TabButton({
  tab,
  active,
  onSelect,
}: {
  tab: TabDefinition
  active: TabKey
  onSelect: (tab: TabKey) => void
}) {
  const isActive = tab.key === active
  const Icon = tab.icon
  return (
    <button
      onClick={() => onSelect(tab.key)}
      aria-label={tab.label}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium',
        isActive ? 'text-accent' : 'text-ink-muted',
      )}
    >
      <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />
      {tab.label}
    </button>
  )
}
