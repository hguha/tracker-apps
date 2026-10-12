import { weekKey } from '@/lib/dates'

export interface ProgressStats {
  totalDaysTrained: number
  prCount: number
  goalWeeks: number
}

export function experience(stats: ProgressStats): number {
  return stats.totalDaysTrained * 10 + stats.prCount * 5 + stats.goalWeeks * 25
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
