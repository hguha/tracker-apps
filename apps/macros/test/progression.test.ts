import { describe, expect, it } from 'vitest'
import { evaluateBadges } from '@/features/badges/catalog'
import {
  celebrationsSince,
  dailyGoals,
  experience,
  levelFor,
  nextBadges,
} from '@/features/badges/progression'
import type { NutritionStats } from '@/domain/types'

const stats = (over: Partial<NutritionStats> = {}): NutritionStats => ({
  daysLogged: 0,
  currentDayStreak: 0,
  bestDayStreak: 0,
  entriesLogged: 0,
  distinctFoods: 0,
  weighInDays: 0,
  bestWeighInStreak: 0,
  daysProteinMet: 0,
  daysWithinTarget: 0,
  daysFiberMet: 0,
  checkInsEarned: 0,
  savedMeals: 0,
  barcodesScanned: 0,
  describedMeals: 0,
  completeWeeks: 0,
  ...over,
})

describe('levels', () => {
  it('starts at level 1 and needs 100 more XP for each level after', () => {
    expect(levelFor(0)).toEqual({ level: 1, xp: 0, floor: 0, next: 100 })
    expect(levelFor(99).level).toBe(1)
    expect(levelFor(100)).toEqual({ level: 2, xp: 100, floor: 100, next: 300 })
    expect(levelFor(300).level).toBe(3)
    expect(levelFor(599).level).toBe(3)
    expect(levelFor(600).level).toBe(4)
  })

  it('earns XP for logging, protein and measuring, never for eating less', () => {
    expect(experience(stats({ daysLogged: 3 }))).toBe(30)
    expect(experience(stats({ daysWithinTarget: 50 }))).toBe(0)
    expect(experience(stats({ daysLogged: 1, daysProteinMet: 1, weighInDays: 1 }))).toBe(25)
  })
})

describe('daily goals', () => {
  const base = {
    entries: 0,
    proteinMg: 0,
    proteinTargetMg: 150_000,
    waterMl: 0,
    waterTargetMl: null,
    weighedIn: false,
  }

  it('lists log, protein, water and weigh-in, none of them done on an empty day', () => {
    const goals = dailyGoals(base)
    expect(goals.map((goal) => goal.key)).toEqual(['log', 'protein', 'water', 'weigh'])
    expect(goals.every((goal) => !goal.done)).toBe(true)
  })

  it('drops protein when there is no target to meet', () => {
    expect(dailyGoals({ ...base, proteinTargetMg: null }).map((goal) => goal.key)).not.toContain(
      'protein',
    )
  })

  it('fills water against two litres when no target is set', () => {
    const water = (ml: number) => dailyGoals({ ...base, waterMl: ml }).find((g) => g.key === 'water')
    expect(water(1_999)?.done).toBe(false)
    expect(water(2_000)?.done).toBe(true)
  })
})

describe('celebrations', () => {
  const day = '2026-10-04'

  it('says nothing the first time, so an existing history is not a flood', () => {
    const badges = evaluateBadges(stats({ daysLogged: 40, bestDayStreak: 10 }))
    const { celebrations, next } = celebrationsSince(null, { badges, level: 5, day, dayComplete: true })
    expect(celebrations).toEqual([])
    expect(next.badges.length).toBeGreaterThan(0)
    expect(next.completedDay).toBe(day)
  })

  it('celebrates a badge once, then not again', () => {
    const before = celebrationsSince(null, {
      badges: evaluateBadges(stats()),
      level: 1,
      day,
      dayComplete: false,
    }).next
    const badges = evaluateBadges(stats({ daysLogged: 1 }))
    const first = celebrationsSince(before, { badges, level: 1, day, dayComplete: false })
    expect(first.celebrations.map((c) => c.title)).toEqual(['Day One'])
    const again = celebrationsSince(first.next, { badges, level: 1, day, dayComplete: false })
    expect(again.celebrations).toEqual([])
  })

  it('folds several new badges into one', () => {
    const before = { badges: [], level: 1, completedDay: null }
    const badges = evaluateBadges(stats({ daysLogged: 7, bestDayStreak: 7 }))
    const { celebrations } = celebrationsSince(before, { badges, level: 1, day, dayComplete: false })
    expect(celebrations).toHaveLength(1)
    expect(celebrations[0]!.title).toMatch(/badges earned/)
  })

  it('marks a level up and a completed day, each once', () => {
    const before = { badges: [], level: 2, completedDay: '2026-10-03' }
    const now = { badges: [], level: 3, day, dayComplete: true }
    const { celebrations, next } = celebrationsSince(before, now)
    expect(celebrations.map((c) => c.title)).toEqual(['Level 3', 'Day complete'])
    expect(celebrationsSince(next, now).celebrations).toEqual([])
  })
})

describe('next badges', () => {
  it('offers the unearned ones closest to done', () => {
    const upcoming = nextBadges(evaluateBadges(stats({ daysLogged: 6, bestDayStreak: 2 })), 2)
    expect(upcoming.map((badge) => badge.key)).toEqual(['week-logged', 'streak-3'])
  })
})
