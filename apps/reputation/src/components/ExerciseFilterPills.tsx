// Body-part filter row (§7.3), shared by the picker and library. Single-select;
// tapping the active pill clears it. Equipment is no longer a filter — any
// movement can use any equipment, so it's chosen when adding, not filtered on.

import { cn } from '@/lib/cn'
import { regionVar } from '@/lib/palette'
import { REGION_LABELS, REGIONS, type Region } from '@/domain/types'

export function ExerciseFilterPills({
  region,
  onRegionChange,
  className,
}: {
  region: Region | null
  onRegionChange: (next: Region | null) => void
  className?: string
}) {
  return (
    <div className={className}>
      <div className="flex gap-1.5 overflow-x-auto px-3 py-2">
        {REGIONS.map((value) => {
          const isActive = region === value
          return (
            <button
              key={value}
              onClick={() => onRegionChange(isActive ? null : value)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium',
                isActive
                  ? 'border-transparent text-white'
                  : 'border-line text-ink-secondary',
              )}
              style={isActive ? { background: regionVar(value) } : undefined}
            >
              {!isActive && (
                <span
                  className="size-2 rounded-full"
                  style={{ background: regionVar(value) }}
                  aria-hidden
                />
              )}
              {REGION_LABELS[value]}
            </button>
          )
        })}
      </div>
    </div>
  )
}
