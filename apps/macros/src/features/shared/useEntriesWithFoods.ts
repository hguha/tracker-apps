import { useLiveQuery } from 'dexie-react-hooks'
import * as repo from '@/data/repository'
import { foodIdsOf } from '@/features/shared/entryName'
import type { Food, LogEntry } from '@/domain/types'

export interface EntriesWithFoods {
  entries: LogEntry[]
  foods: Map<string, Food>
}

export function useEntriesWithFoods(fromDay: string, toDay: string): EntriesWithFoods | undefined {
  return useLiveQuery(
    async () => {
      const entries = await repo.entriesBetween(fromDay, toDay)
      return { entries, foods: await repo.foodsByIds(foodIdsOf(entries)) }
    },
    [fromDay, toDay],
    undefined,
  )
}
