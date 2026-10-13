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

export const shownExperience = (highWater: number, earned: number): number =>
  Math.max(highWater, earned)

export function takeLegacyHighWater(storageKey: string): number {
  const stored = Number(localStorage.getItem(storageKey) ?? 0)
  localStorage.removeItem(storageKey)
  return Number.isFinite(stored) ? stored : 0
}
