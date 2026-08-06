/**
 * A searchable multi-select sheet, used by every filter chip (§9.0, §7.3).
 *
 * The reason filters live in a sheet rather than an inline pill row: with 200
 * exercises or 30 muscles, pills wrap into a wall and stop being scannable. A
 * chip that summarizes ("3 body parts") plus a searchable sheet stays the same
 * size no matter how much data exists.
 *
 * Search is only rendered past a threshold, so a 7-option list doesn't get a
 * search box it doesn't need.
 */

import { useMemo, useState } from 'react'
import { Check, Search, X } from 'lucide-react'
import { BottomSheet } from '@/components/BottomSheet'
import { Button } from '@/components/Button'
import { cn } from '@/lib/cn'

const SEARCHABLE_THRESHOLD = 12

export interface FilterOption {
  value: string
  label: string
  /** Optional color dot, e.g. a region's fixed palette color. */
  swatch?: string
  /** Secondary line, e.g. an exercise's muscle and equipment. */
  hint?: string
  /** Options sharing a group render under a group heading. */
  group?: string
}

export function FilterSheet({
  title,
  options,
  selected,
  onChange,
  onDismiss,
  singleSelect = false,
}: {
  title: string
  options: FilterOption[]
  selected: string[]
  onChange: (selected: string[]) => void
  onDismiss: () => void
  singleSelect?: boolean
}) {
  const [query, setQuery] = useState('')
  const isSearchable = options.length >= SEARCHABLE_THRESHOLD

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return options
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(normalized) ||
        option.hint?.toLowerCase().includes(normalized),
    )
  }, [options, query])

  /** Preserve the caller's ordering while inserting group headings. */
  const grouped = useMemo(() => {
    const groups: { name: string | undefined; options: FilterOption[] }[] = []
    for (const option of filtered) {
      const last = groups[groups.length - 1]
      if (last && last.name === option.group) last.options.push(option)
      else groups.push({ name: option.group, options: [option] })
    }
    return groups
  }, [filtered])

  function toggle(value: string) {
    if (singleSelect) {
      onChange([value])
      onDismiss()
      return
    }
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    )
  }

  return (
    <BottomSheet onDismiss={onDismiss} panelClassName="flex max-h-[85%] flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 className="text-[17px] font-bold tracking-tight">{title}</h2>
        <div className="flex items-center gap-1">
          {!singleSelect && selected.length > 0 && (
            <button
              onClick={() => onChange([])}
              className="px-2 text-[13.5px] font-semibold text-accent"
            >
              Clear
            </button>
          )}
          <button
            onClick={onDismiss}
            aria-label="Close"
            className="flex size-9 items-center justify-center rounded-lg text-ink-muted active:bg-sunken"
          >
            <X size={19} />
          </button>
        </div>
      </div>

      {isSearchable && (
        <div className="border-b border-line px-4 py-2.5">
          <div className="flex h-10 items-center gap-2 rounded-xl bg-sunken px-3">
            <Search size={16} className="shrink-0 text-ink-muted" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${title.toLowerCase()}`}
              className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-muted"
            />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {grouped.map((group, groupIndex) => (
          <div key={group.name ?? groupIndex}>
            {group.name && (
              <p className="sticky top-0 bg-sunken px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                {group.name}
              </p>
            )}
            {group.options.map((option) => {
              const isSelected = selected.includes(option.value)
              return (
                <button
                  key={option.value}
                  onClick={() => toggle(option.value)}
                  className="flex w-full items-center gap-3 border-b border-line px-5 py-3 text-left active:bg-accent-wash"
                >
                  {option.swatch && (
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: option.swatch }}
                      aria-hidden
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">
                      {option.label}
                    </span>
                    {option.hint && (
                      <span className="block truncate text-[12.5px] text-ink-muted">
                        {option.hint}
                      </span>
                    )}
                  </span>
                  {isSelected && (
                    <Check size={17} strokeWidth={3} className="shrink-0 text-accent" />
                  )}
                </button>
              )
            })}
          </div>
        ))}

        {filtered.length === 0 && (
          <p className="px-5 py-8 text-center text-[14px] text-ink-muted">
            Nothing matches "{query.trim()}".
          </p>
        )}
      </div>

      {!singleSelect && (
        <div className="border-t border-line px-4 py-3">
          <Button size="lg" className="w-full" onClick={onDismiss}>
            {selected.length === 0
              ? 'Show all'
              : `Apply ${selected.length} ${selected.length === 1 ? 'filter' : 'filters'}`}
          </Button>
        </div>
      )}
    </BottomSheet>
  )
}

/** Shared chip renderer so every filter bar looks identical. */
export function FilterChipButton({
  label,
  isActive,
  onClick,
}: {
  label: string
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-full border px-3 py-1.5 text-[13px] font-medium',
        isActive
          ? 'border-accent bg-accent-wash text-accent'
          : 'border-line text-ink-secondary',
      )}
    >
      {label} ▾
    </button>
  )
}
