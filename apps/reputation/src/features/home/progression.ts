import { weekKey } from '@/lib/dates'

export interface ProgressStats {
  totalDaysTrained: number
  recordSessions: number
  goalWeeks: number
}

export function experience(stats: ProgressStats): number {
  return stats.totalDaysTrained * 10 + stats.recordSessions * 5 + stats.goalWeeks * 25
}

export function goalWeeksMet(
  startedAts: readonly number[],
  weekStartsOn: 0 | 1,
  weeklyGoal: number,
): number {
  const perWeek = new Map<string, number>()
  for (const at of startedAts) {
    const key = weekKey(at, weekStartsOn)
    perWeek.set(key, (perWeek.get(key) ?? 0) + 1)
  }
  return [...perWeek.values()].filter((count) => count >= weeklyGoal).length
}

export function shownExperience(storageKey: string | null, earned: number): number {
  if (storageKey === null) return earned
  const best = Number(localStorage.getItem(storageKey) ?? 0)
  if (earned <= best) return best
  localStorage.setItem(storageKey, String(earned))
  return earned
}
