import { BarChart3, CalendarDays, Home, Settings } from 'lucide-react'
import { TabBar as BaseTabBar, type TabDefinition } from '@tracker-engine/ui'

export type TabKey = 'today' | 'history' | 'trends' | 'settings'

const LEFT: TabDefinition<TabKey>[] = [
  { key: 'today', label: 'Today', icon: Home },
  { key: 'history', label: 'History', icon: CalendarDays },
]

const RIGHT: TabDefinition<TabKey>[] = [
  { key: 'trends', label: 'Trends', icon: BarChart3 },
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
    <BaseTabBar
      left={LEFT}
      right={RIGHT}
      active={active}
      onSelect={onSelect}
      centerLabel="Log food"
      onCenter={onLog}
    />
  )
}
