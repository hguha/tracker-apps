import { useLiveQuery } from 'dexie-react-hooks'
import { METRIC, unitsFor, type UnitPreference } from '@tracker-engine/core'
import * as repo from '@/data/repository'

/**
 * The user's units, for every screen that shows a weight or a height.
 *
 * A hook rather than a prop drilled from the top, because the alternative is what shipped: the
 * setting existed, synced, and displayed itself in Settings, while every screen printed kg
 * regardless. One read per screen off a live query is cheap; a setting that silently does nothing
 * is not.
 *
 * Storage stays metric always — kg and cm — and conversion happens only at the edges, in
 * `@tracker-engine/core`'s units module, shared with REPutation so the two apps cannot disagree
 * about what a bodyweight is.
 */
export function useUnits(): UnitPreference {
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)
  return profile ? unitsFor(profile.units) : METRIC
}
