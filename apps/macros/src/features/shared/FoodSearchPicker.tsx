import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { SearchField } from '@tracker-engine/ui'
import { Plus } from 'lucide-react'
import * as repo from '@/data/repository'
import { searchRemote } from '@/data/foodLookup'
import { portionLabel } from '@/features/shared/format'
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

  const results = useLiveQuery(() => repo.searchFoods(trimmed, limit), [trimmed, limit], [])

  useEffect(() => {
    if (trimmed.length < 3 || (results?.length ?? 0) >= 3) return
    const id = window.setTimeout(() => void searchRemote(trimmed, { branded }), 400)
    return () => clearTimeout(id)
  }, [trimmed, results?.length, branded])

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
            {(results ?? []).map((food) => (
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
          {children?.(trimmed)}
        </>
      )}
    </div>
  )
}
