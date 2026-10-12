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

import { BarChart3, CalendarDays, Dumbbell, Home, User } from 'lucide-react'
import { TabBar as BaseTabBar, type TabDefinition } from '@tracker-engine/ui'

export type TabKey = 'home' | 'history' | 'library' | 'insights' | 'me'

const LEFT_TABS: TabDefinition<TabKey>[] = [
  { key: 'home', label: 'Home', icon: Home },
  { key: 'history', label: 'History', icon: CalendarDays },
]

const RIGHT_TABS: TabDefinition<TabKey>[] = [
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
    <BaseTabBar
      left={LEFT_TABS}
      right={RIGHT_TABS}
      active={active}
      onSelect={onSelect}
      activeFor={{ library: 'me' }}
      centerLabel={hasActiveWorkout ? 'Back to your workout' : 'Log a workout'}
      onCenter={onStartWorkout}
      isCenterPulsing={hasActiveWorkout}
      centerIcon={hasActiveWorkout ? <Dumbbell size={24} strokeWidth={2.5} /> : undefined}
    />
  )
}
