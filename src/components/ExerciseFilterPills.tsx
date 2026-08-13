// Body-part and equipment filter rows (§7.3), shared by the picker and library.
// Single-select per row; tapping the active pill clears it.

import { cn } from '@/lib/cn'
import { regionVar } from '@/lib/palette'
import { humanizeSlug } from '@/lib/labels'
import { EQUIPMENT, REGION_LABELS, REGIONS, type Region } from '@/domain/types'

export function ExerciseFilterPills({
  region,
  equipment,
  onRegionChange,
  onEquipmentChange,
  className,
}: {
  region: Region | null
  equipment: string | null
  onRegionChange: (next: Region | null) => void
  onEquipmentChange: (next: string | null) => void
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

      <div className="flex gap-1.5 overflow-x-auto px-3 pb-2">
        {EQUIPMENT.map((value) => {
          const isActive = equipment === value
          return (
            <button
              key={value}
              onClick={() => onEquipmentChange(isActive ? null : value)}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1.5 text-[13px] font-medium',
                isActive
                  ? 'border-accent bg-accent-wash text-accent'
                  : 'border-line text-ink-secondary',
              )}
            >
              {humanizeSlug(value)}
            </button>
          )
        })}
      </div>
    </div>
  )
}
