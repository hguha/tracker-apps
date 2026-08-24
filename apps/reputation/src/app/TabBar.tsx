/**
 * Bottom tab bar (§5.2). Four tabs plus a center action.
 *
 * Four is the cap: a fifth would shrink each target below comfortable thumb
 * reach, so the exercise library is reached through More rather than claiming
 * its own slot.
 *
 * Sign-out lives in Settings, deliberately not here — it must not be one
 * mis-tap away from an in-progress session.
 */

import { BarChart3, CalendarDays, Dumbbell, Home, Plus, User } from 'lucide-react'
import { cn } from '@/lib/cn'

export type TabKey = 'home' | 'history' | 'library' | 'insights' | 'me'

type TabDefinition = { key: TabKey; label: string; icon: typeof Home }

const LEFT_TABS: TabDefinition[] = [
  { key: 'home', label: 'Home', icon: Home },
  { key: 'history', label: 'History', icon: CalendarDays },
]

const RIGHT_TABS: TabDefinition[] = [
  { key: 'insights', label: 'Insights', icon: BarChart3 },
  { key: 'me', label: 'More', icon: User },
]

export function TabBar({
  active,
  onSelect,
  onStartWorkout,
  hasActiveWorkout = false,
}: {
  active: TabKey
  onSelect: (tab: TabKey) => void
  onStartWorkout: () => void
  hasActiveWorkout?: boolean
}) {
  return (
    <nav className="relative border-t border-line bg-surface pb-safe">
      <div className="flex items-stretch">
        {LEFT_TABS.map((tab) => (
          <TabButton key={tab.key} tab={tab} active={active} onSelect={onSelect} />
        ))}

        {/* Center action, raised so it reads as primary rather than a fifth tab.
            Mid-session it returns to that workout instead of starting one, so it
            drops the plus for the session glyph and a live pulse. */}
        <div className="relative flex w-16 shrink-0 justify-center">
          {hasActiveWorkout && (
            <span
              aria-hidden
              className="pointer-events-none absolute -top-4 size-14 animate-ping rounded-full bg-accent opacity-25"
            />
          )}
          <button
            onClick={onStartWorkout}
            aria-label={hasActiveWorkout ? 'Back to your workout' : 'Log a workout'}
            className="relative z-10 -mt-4 flex size-14 items-center justify-center rounded-full bg-accent text-accent-contrast shadow-lg active:brightness-90"
          >
            {hasActiveWorkout ? (
              <Dumbbell size={24} strokeWidth={2.5} />
            ) : (
              <Plus size={26} strokeWidth={2.5} />
            )}
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
  const Icon = tab.icon
  // The library is reached through More, so keep that tab lit while browsing it.
  const isActive = active === tab.key || (tab.key === 'me' && active === 'library')
  return (
    <button
      onClick={() => onSelect(tab.key)}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'flex flex-1 flex-col items-center gap-0.5 py-2',
        isActive ? 'text-accent' : 'text-ink-muted',
      )}
    >
      <Icon size={22} strokeWidth={isActive ? 2.4 : 2} />
      <span className="text-[10.5px] font-semibold">{tab.label}</span>
    </button>
  )
}
