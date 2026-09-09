import type { ReactNode } from 'react'
import { cn } from '@tracker-engine/core'

export interface SegmentedTab<K extends string> {
  key: K
  label: string
  icon?: ReactNode
  /** A count or hint after the label, e.g. "12". */
  badge?: string | number
}

/**
 * A row of tabs for switching what a screen shows.
 *
 * Scrolls horizontally rather than wrapping or shrinking the labels: a tab strip that reflows
 * to two lines moves the content under the user's thumb between renders.
 */
export function SegmentedTabs<K extends string>({
  tabs,
  active,
  onSelect,
  variant = 'pill',
}: {
  tabs: readonly SegmentedTab<K>[]
  active: K
  onSelect: (key: K) => void
  /** `pill` for a sunken track (toggle), `underline` for section navigation. */
  variant?: 'pill' | 'underline'
}) {
  if (variant === 'underline') {
    return (
      <div className="flex gap-1 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onSelect(tab.key)}
            aria-pressed={active === tab.key}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13.5px] font-semibold',
              active === tab.key
                ? 'bg-accent-wash text-accent'
                : 'text-ink-secondary active:bg-sunken',
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.badge !== undefined && (
              <span className="tabular text-[11.5px] font-normal opacity-70">{tab.badge}</span>
            )}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="flex gap-1 rounded-xl bg-sunken p-1">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onSelect(tab.key)}
          aria-pressed={active === tab.key}
          className={cn(
            'flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold',
            active === tab.key ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted',
          )}
        >
          {tab.icon}
          {tab.label}
          {tab.badge !== undefined && (
            <span className="tabular text-[11.5px] font-normal opacity-70">{tab.badge}</span>
          )}
        </button>
      ))}
    </div>
  )
}
