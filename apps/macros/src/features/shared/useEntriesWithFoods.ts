import { useLiveQuery } from 'dexie-react-hooks'
import * as repo from '@/data/repository'
import type { Food, LogEntry } from '@/domain/types'

export interface EntriesWithFoods {
  entries: LogEntry[]
  foods: Map<string, Food>
}

export function useEntriesWithFoods(fromDay: string, toDay: string): EntriesWithFoods | undefined {
  const loaded = useLiveQuery(
    async () => {
      const entries = await repo.entriesBetween(fromDay, toDay)
      return { fromDay, toDay, entries, foods: await repo.foodsByIds(entries.map((entry) => entry.foodId)) }
    },
    [fromDay, toDay],
    undefined,
  )
  return loaded?.fromDay === fromDay && loaded.toDay === toDay ? loaded : undefined
}
