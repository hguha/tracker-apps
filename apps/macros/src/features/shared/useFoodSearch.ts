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
 * The local-then-remote rule lives here too, in one place: show the cache immediately, ask the
 * databases once per query, and never block on either — so rows already on screen can't vanish
 * mid-fetch and the answer to a word doesn't depend on what was searched for before it.
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
const DEBOUNCE_MS = 400

/**
 * Queries already sent this session, so retyping one is free.
 *
 * Keyed on the **query**, which is the difference between this and what it replaces. The old rule
 * skipped the network whenever five local rows happened to match, and the local cache grows with use
 * — so the results for a word depended on what you had searched for before it. Searching "carrot
 * cake" returned two rows, then twenty the next time; "granola" returned the ten granola-bar rows
 * that ship in the seed and therefore *never asked USDA at all*, which is why it only ever showed
 * cereals. A query-keyed cache gives the same answer every time and still costs one request.
 */
const asked = new Set<string>()

export function useFoodSearch(
  query: string,
  { limit = 40, branded = true }: { limit?: number; branded?: boolean } = {},
): FoodSearchState {
  const trimmed = query.trim()
  const results = useLiveQuery(() => repo.searchFoods(trimmed, limit), [trimmed, limit], undefined)
  const [searchingFor, setSearchingFor] = useState<string | null>(null)

  useEffect(() => {
    const key = `${branded ? 'b' : 'g'}:${trimmed.toLowerCase()}`
    if (trimmed.length < MIN_REMOTE_CHARS || asked.has(key)) return
    let cancelled = false
    const id = window.setTimeout(() => {
      asked.add(key)
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
  }, [trimmed, branded])

  const isSearching = searchingFor === trimmed && trimmed.length >= MIN_REMOTE_CHARS

  return {
    results: results ?? [],
    isSearching,
    // Undefined results means the local query hasn't run yet, which is not the same as "nothing".
    isEmpty: results !== undefined && results.length === 0 && !isSearching,
  }
}
