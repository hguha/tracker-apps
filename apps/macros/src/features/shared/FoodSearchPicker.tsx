import { useState } from 'react'
import { SearchField } from '@tracker-engine/ui'
import { Loader2, Plus } from 'lucide-react'
import { portionLabel } from '@/features/shared/format'
import { useFoodSearch } from '@/features/shared/useFoodSearch'
import type { Food } from '@/domain/types'

/**
 * Search a food and pick it.
 *
 * One component because three screens had grown their own copy of it — the recipe editor, the
 * estimate reviewer's "something missing?" box, and the log screen's search — each with its own
 * debounce interval and its own idea of when to reach for the network. The local-then-remote rule
 * is the part that must not diverge: results already on screen must never vanish because a fetch
 * is in flight, and the remote call must only happen when the local cache came up thin.
 */
export function FoodSearchPicker({
  placeholder,
  onPick,
  limit = 6,
  branded = true,
  minChars = 2,
  autoFocus = false,
  children,
}: {
  placeholder: string
  onPick: (food: Food) => void
  limit?: number
  /** False for ingredient matching: packaged rows are the wrong answer for "cooked spaghetti". */
  branded?: boolean
  minChars?: number
  autoFocus?: boolean
  /** Rendered under the results, with the current query — for an "ask instead" escape hatch. */
  children?: (query: string) => React.ReactNode
}) {
  const [query, setQuery] = useState('')
  const trimmed = query.trim()
  const { results, isSearching, isEmpty } = useFoodSearch(query, { limit, branded })

  return (
    <div>
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />

      {trimmed.length >= minChars && (
        <>
          <ul className="mt-1.5">
            {results.map((food) => (
              <li key={food.id}>
                <button
                  onClick={() => {
                    onPick(food)
                    setQuery('')
                  }}
                  className="flex w-full items-center gap-2 py-1.5 text-left active:opacity-60"
                >
                  <Plus size={14} className="shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 truncate text-[13.5px]">
                    {food.description}
                    {food.portions.length > 0 && (
                      <span className="text-ink-muted"> · {portionLabel(food.portions[0]!)}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {isSearching && <SearchingRow />}
          {isEmpty && !isSearching && (
            <p className="py-1.5 text-[12.5px] text-ink-muted">Nothing matched.</p>
          )}
          {children?.(trimmed)}
        </>
      )}
    </div>
  )
}

/** Said out loud, because "Nothing matched" while still looking is a confident wrong answer. */
export function SearchingRow() {
  return (
    <p className="flex items-center gap-1.5 py-1.5 text-[12.5px] text-ink-muted">
      <Loader2 size={13} className="shrink-0 animate-spin" />
      Searching the food databases…
    </p>
  )
}
