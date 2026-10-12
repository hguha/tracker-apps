import type { NutritionStats } from '@/domain/types'

export function experience(stats: NutritionStats): number {
  return (
    stats.daysLogged * 10 +
    stats.daysProteinMet * 10 +
    stats.weighInDays * 5 +
    stats.daysFiberMet * 5 +
    stats.completeWeeks * 25 +
    stats.checkInsEarned * 25
  )
}

export type DailyGoalKey = 'log' | 'protein' | 'water' | 'weigh'

export interface DailyGoal {
  key: DailyGoalKey
  label: string
  done: boolean
}

const DEFAULT_WATER_ML = 2000

export function dailyGoals(today: {
  entries: number
  proteinMg: number
  proteinTargetMg: number | null
  waterMl: number
  waterTargetMl: number | null
  weighedIn: boolean
}): DailyGoal[] {
  const goals: DailyGoal[] = [{ key: 'log', label: 'Log', done: today.entries > 0 }]
  if (today.proteinTargetMg !== null && today.proteinTargetMg > 0) {
    goals.push({ key: 'protein', label: 'Protein', done: today.proteinMg >= today.proteinTargetMg })
  }
  goals.push({
    key: 'water',
    label: 'Water',
    done: today.waterMl >= (today.waterTargetMl ?? DEFAULT_WATER_ML),
  })
  goals.push({ key: 'weigh', label: 'Weigh in', done: today.weighedIn })
  return goals
}
