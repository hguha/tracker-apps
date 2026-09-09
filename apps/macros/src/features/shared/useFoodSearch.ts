import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import * as repo from '@/data/repository'
import { searchRemote } from '@/data/foodLookup'
import type { Food } from '@/domain/types'

/**
 * Searching for a food: what's cached, plus whatever the databases have, plus whether it's still
 * looking.
 *
 * That last part is the whole reason this is a hook. The local cache holds a few dozen staples, so
 * "guacamole" and "refried beans" genuinely aren't there — they arrive from USDA three to six
 * seconds later, and for those seconds every screen said **"Nothing matched."** A confident wrong
 * answer is worse than a slow right one, and it made a working search look like a missing database.
 *
 * The local-then-remote rule lives here too, in one place: only reach for the network when the
 * cache comes up thin, and never block on it, so rows already on screen can't vanish mid-fetch.
 */
export interface FoodSearchState {
  results: Food[]
  /** True while a remote lookup for the current query is in flight. */
  isSearching: boolean
  /** True when the search has finished and genuinely found nothing. */
  isEmpty: boolean
}

/** Below this a query is too vague to spend a request on. */
const MIN_REMOTE_CHARS = 3
/** Enough local hits that the long tail isn't worth a round trip. */
const ENOUGH_LOCAL = 5
const DEBOUNCE_MS = 400

export function useFoodSearch(
  query: string,
  { limit = 40, branded = true }: { limit?: number; branded?: boolean } = {},
): FoodSearchState {
  const trimmed = query.trim()
  const results = useLiveQuery(() => repo.searchFoods(trimmed, limit), [trimmed, limit], undefined)
  const [searchingFor, setSearchingFor] = useState<string | null>(null)

  const enough = (results?.length ?? 0) >= ENOUGH_LOCAL

  useEffect(() => {
    if (trimmed.length < MIN_REMOTE_CHARS || enough) return
    let cancelled = false
    const id = window.setTimeout(() => {
      setSearchingFor(trimmed)
      void searchRemote(trimmed, { branded }).finally(() => {
        // Guarded on the query, not just on unmount: an older search settling must not clear the
        // spinner belonging to a newer one.
        if (!cancelled) setSearchingFor((current) => (current === trimmed ? null : current))
      })
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [trimmed, enough, branded])

  const isSearching = searchingFor === trimmed && trimmed.length >= MIN_REMOTE_CHARS

  return {
    results: results ?? [],
    isSearching,
    // Undefined results means the local query hasn't run yet, which is not the same as "nothing".
    isEmpty: results !== undefined && results.length === 0 && !isSearching,
  }
}
