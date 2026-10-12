import type { ComponentType, ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { cn } from '@tracker-engine/core'

export interface TabDefinition<K extends string> {
  key: K
  label: string
  icon: ComponentType<{ size?: number; strokeWidth?: number }>
}

/**
 * Bottom tab bar: two tabs each side of a raised centre action, which is always the app's
 * primary "add something" verb.
 */
export function TabBar<K extends string>({
  left,
  right,
  active,
  onSelect,
  centerLabel,
  onCenter,
  centerIcon = <Plus size={26} strokeWidth={2.5} />,
  isCenterPulsing = false,
  activeFor = {},
}: {
  left: readonly TabDefinition<K>[]
  right: readonly TabDefinition<K>[]
  active: K
  onSelect: (tab: K) => void
  centerLabel: string
  onCenter: () => void
  centerIcon?: ReactNode
  isCenterPulsing?: boolean
  activeFor?: Partial<Record<K, K>>
}) {
  const lit = activeFor[active] ?? active
  return (
    <nav className="relative border-t border-line bg-surface pb-safe">
      <div className="flex items-stretch">
        {left.map((tab) => (
          <TabButton key={tab.key} tab={tab} active={lit} onSelect={onSelect} />
        ))}

        <div className="relative flex w-16 shrink-0 justify-center">
          {isCenterPulsing && (
            <span
              aria-hidden
              className="pointer-events-none absolute -top-4 size-14 animate-ping rounded-full bg-accent opacity-25"
            />
          )}
          <button
            onClick={onCenter}
            aria-label={centerLabel}
            className="relative z-10 -mt-4 flex size-14 items-center justify-center rounded-full bg-accent text-accent-contrast shadow-lg active:brightness-90"
          >
            {centerIcon}
          </button>
        </div>

        {right.map((tab) => (
          <TabButton key={tab.key} tab={tab} active={lit} onSelect={onSelect} />
        ))}
      </div>
    </nav>
  )
}

function TabButton<K extends string>({
  tab,
  active,
  onSelect,
}: {
  tab: TabDefinition<K>
  active: K
  onSelect: (tab: K) => void
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
