/**
 * The in-progress session, live. `undefined` while loading, `null` when none.
 *
 * Starting a workout is reachable from several places — the tab bar, Home,
 * Templates, and "do this again" in History — and only the first two went
 * through the resume check. The others could open a second concurrent session,
 * which §4.4 says cannot exist: the new one becomes the active workout and the
 * old one is stranded, unfinishable from the UI. Every start affordance reads
 * this so it can offer *resume* instead of a duplicate.
 */

import { useLiveQuery } from 'dexie-react-hooks'
import * as repo from '@/data/repository'
import type { Workout } from '@/domain/types'

export function useActiveWorkout(): Workout | null | undefined {
  return useLiveQuery(async () => (await repo.getActiveWorkout()) ?? null, [])
}
