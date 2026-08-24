// The in-progress session, live (undefined while loading, null when none). Every
// start affordance reads this to offer resume instead of a second session (§4.4).

import { useLiveQuery } from 'dexie-react-hooks'
import * as repo from '@/data/repository'
import type { Workout } from '@/domain/types'

export function useActiveWorkout(): Workout | null | undefined {
  return useLiveQuery(async () => (await repo.getActiveWorkout()) ?? null, [])
}
