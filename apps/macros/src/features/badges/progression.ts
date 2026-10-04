import type { NutritionStats } from '@/domain/types'
import type { BadgeState } from './catalog'

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

export interface Level {
  level: number
  xp: number
  floor: number
  next: number
}

export function levelFor(xp: number): Level {
  let level = 1
  let floor = 0
  while (xp >= floor + level * 100) {
    floor += level * 100
    level += 1
  }
  return { level, xp, floor, next: floor + level * 100 }
}

export type DailyGoalKey = 'log' | 'protein' | 'water' | 'weigh'

export interface DailyGoal {
  key: DailyGoalKey
  label: string
  done: boolean
}

export const DEFAULT_WATER_ML = 2000

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

export interface Celebrated {
  badges: string[]
  level: number
  completedDay: string | null
}

export interface Celebration {
  key: string
  icons: string[]
  title: string
  subtitle: string
}

export function celebrationsSince(
  previous: Celebrated | null,
  now: { badges: readonly BadgeState[]; level: number; day: string; dayComplete: boolean },
): { celebrations: Celebration[]; next: Celebrated } {
  const earned = now.badges.filter((badge) => badge.earned)
  const next: Celebrated = {
    badges: earned.map((badge) => badge.key),
    level: Math.max(now.level, previous?.level ?? 0),
    completedDay: now.dayComplete ? now.day : (previous?.completedDay ?? null),
  }
  if (previous === null) return { celebrations: [], next }

  const celebrations: Celebration[] = []
  const known = new Set(previous.badges)
  const fresh = earned.filter((badge) => !known.has(badge.key))
  if (fresh.length === 1) {
    const [badge] = fresh
    celebrations.push({
      key: `badge:${badge!.key}`,
      icons: [badge!.icon],
      title: badge!.label,
      subtitle: badge!.caption,
    })
  } else if (fresh.length > 1) {
    celebrations.push({
      key: `badges:${fresh.map((badge) => badge.key).join(',')}`,
      icons: fresh.slice(0, 3).map((badge) => badge.icon),
      title: `${fresh.length} badges earned`,
      subtitle: fresh.map((badge) => badge.label).join(' · '),
    })
  }
  if (now.level > previous.level) {
    celebrations.push({
      key: `level:${now.level}`,
      icons: ['⭐'],
      title: `Level ${now.level}`,
      subtitle: 'Earned by showing up.',
    })
  }
  if (now.dayComplete && previous.completedDay !== now.day) {
    celebrations.push({
      key: `day:${now.day}`,
      icons: ['✅'],
      title: 'Day complete',
      subtitle: 'Every goal for today, done.',
    })
  }
  return { celebrations, next }
}

export function nextBadges(all: readonly BadgeState[], count: number): BadgeState[] {
  return all
    .filter((badge) => !badge.earned)
    .sort((a, b) => b.fraction - a.fraction)
    .slice(0, count)
}
