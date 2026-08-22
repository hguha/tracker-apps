// The Strength tab's one filter: pick the single lift a chart plots. Body-part
// pills and a name search narrow a long library down fast; the list is
// single-select because the strength charts each show exactly one exercise.

import { useMemo, useState } from 'react'
import { Check, Search, X } from 'lucide-react'
import { BottomSheet } from '@/components/BottomSheet'
import { ExerciseFilterPills } from '@/components/ExerciseFilterPills'
import { regionVar } from '@/lib/palette'
import { REGION_LABELS, REGIONS, type Region } from '@/domain/types'

export interface ExerciseOption {
  id: string
  name: string
  region: Region | undefined
}

export function ExerciseFilterSheet({
  options,
  selectedId,
  onSelect,
  onDismiss,
}: {
  options: ExerciseOption[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onDismiss: () => void
}) {
  const [query, setQuery] = useState('')
  const [region, setRegion] = useState<Region | null>(null)

  const groups = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const matched = options.filter((option) => {
      if (region && option.region !== region) return false
      if (normalized && !option.name.toLowerCase().includes(normalized)) return false
      return true
    })
    // Region slot order, so the sections match every chart legend.
    matched.sort((a, b) => {
      const ai = a.region ? REGIONS.indexOf(a.region) : REGIONS.length
      const bi = b.region ? REGIONS.indexOf(b.region) : REGIONS.length
      return ai - bi || a.name.localeCompare(b.name)
    })
    const byRegion: { name: string; region: Region | undefined; items: ExerciseOption[] }[] =
      []
    for (const option of matched) {
      const last = byRegion[byRegion.length - 1]
      if (last && last.region === option.region) last.items.push(option)
      else
        byRegion.push({
          name: option.region ? REGION_LABELS[option.region] : 'Other',
          region: option.region,
          items: [option],
        })
    }
    return byRegion
  }, [options, query, region])

  return (
    <BottomSheet onDismiss={onDismiss} panelClassName="flex max-h-[85%] flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 className="text-[17px] font-bold tracking-tight">Exercise</h2>
        <button
          onClick={onDismiss}
          aria-label="Close"
          className="flex size-9 items-center justify-center rounded-lg text-ink-muted active:bg-sunken"
        >
          <X size={19} />
        </button>
      </div>

      <div className="border-b border-line px-4 py-2.5">
        <div className="flex h-10 items-center gap-2 rounded-xl bg-sunken px-3">
          <Search size={16} className="shrink-0 text-ink-muted" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search exercises"
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-muted"
          />
        </div>
      </div>

      {/* Body-part pills narrow the list; tapping the active one clears it. */}
      <ExerciseFilterPills
        region={region}
        onRegionChange={setRegion}
        className="border-b border-line"
      />

      <div className="flex-1 overflow-y-auto">
        <button
          onClick={() => {
            onSelect(null)
            onDismiss()
          }}
          className="flex w-full items-center gap-3 border-b border-line px-5 py-3 text-left active:bg-accent-wash"
        >
          <span className="min-w-0 flex-1 text-[15px] font-medium">All exercises</span>
          {selectedId === null && (
            <Check size={17} strokeWidth={3} className="shrink-0 text-accent" />
          )}
        </button>

        {groups.map((group) => (
          <div key={group.name}>
            <p className="sticky top-0 bg-sunken px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              {group.name}
            </p>
            {group.items.map((option) => (
              <button
                key={option.id}
                onClick={() => {
                  onSelect(option.id)
                  onDismiss()
                }}
                className="flex w-full items-center gap-3 border-b border-line px-5 py-3 text-left active:bg-accent-wash"
              >
                {option.region && (
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: regionVar(option.region) }}
                    aria-hidden
                  />
                )}
                <span className="min-w-0 flex-1 truncate text-[15px] font-medium">
                  {option.name}
                </span>
                {selectedId === option.id && (
                  <Check size={17} strokeWidth={3} className="shrink-0 text-accent" />
                )}
              </button>
            ))}
          </div>
        ))}

        {groups.length === 0 && (
          <p className="px-5 py-8 text-center text-[14px] text-ink-muted">
            No exercise matches.
          </p>
        )}
      </div>
    </BottomSheet>
  )
}
