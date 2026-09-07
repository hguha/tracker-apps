import { DAY_MS, dayKey } from '@tracker-engine/core'
import type { MealSlot, Nutrients } from '@/domain/types'

/**
 * A plausible history, so every screen has something real to show.
 *
 * Pure and deterministic from a seed, so it can build the in-app demo *and* seed a server-side
 * demo account from the same definition — two generators would drift and the demo account would
 * stop matching what a reviewer sees locally.
 *
 * "Plausible" is doing work here. The check-in algorithm needs weight noise around a trend and
 * days with gaps, or it either can't run at all or produces a suspiciously perfect answer. So
 * this generates a real deficit with water-weight scatter and a couple of missed days.
 */

export interface DemoDay {
  day: string
  entries: { foodQuery: string; grams: number; meal: MealSlot }[]
  weightKg: number | null
}

export interface DemoPlan {
  days: DemoDay[]
  program: { goal: 'lose'; ratePctPerWeek: number; proteinGPerKg: number; fatMinPctKcal: number }
  profile: { heightCm: number; birthYear: number; sex: 'male'; dietNotes: string }
}

/** Deterministic noise: a demo that shuffles every reload is impossible to talk about. */
function pseudoRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
}

const BREAKFASTS: { foodQuery: string; grams: number }[][] = [
  [
    { foodQuery: 'Oats, rolled, dry', grams: 60 },
    { foodQuery: 'Milk, 2% fat', grams: 200 },
    { foodQuery: 'Blueberries, raw', grams: 80 },
  ],
  [
    { foodQuery: 'Egg, whole, raw', grams: 100 },
    { foodQuery: 'Bread, whole wheat', grams: 56 },
    { foodQuery: 'Avocado, raw', grams: 60 },
  ],
  [
    { foodQuery: 'Greek yogurt, plain, nonfat', grams: 200 },
    { foodQuery: 'Banana, raw', grams: 118 },
    { foodQuery: 'Almonds, raw', grams: 20 },
  ],
]

const LUNCHES: { foodQuery: string; grams: number }[][] = [
  [
    { foodQuery: 'Chicken breast, skinless, raw', grams: 180 },
    { foodQuery: 'Rice, brown, cooked', grams: 220 },
    { foodQuery: 'Broccoli, raw', grams: 120 },
  ],
  [
    { foodQuery: 'Tofu, firm', grams: 150 },
    { foodQuery: 'Quinoa, cooked', grams: 200 },
    { foodQuery: 'Bell pepper, red, raw', grams: 100 },
  ],
  [
    { foodQuery: 'Black beans, cooked', grams: 180 },
    { foodQuery: 'Tortilla, flour', grams: 90 },
    { foodQuery: 'Cheddar cheese', grams: 30 },
  ],
]

const DINNERS: { foodQuery: string; grams: number }[][] = [
  [
    { foodQuery: 'Salmon, Atlantic, raw', grams: 170 },
    { foodQuery: 'Potato, russet, raw', grams: 250 },
    { foodQuery: 'Spinach, raw', grams: 80 },
  ],
  [
    { foodQuery: 'Ground beef, 90% lean, raw', grams: 150 },
    { foodQuery: 'Pasta, cooked', grams: 240 },
    { foodQuery: 'Tomato, raw', grams: 120 },
  ],
  [
    { foodQuery: 'Chicken thigh, skinless, raw', grams: 180 },
    { foodQuery: 'Sweet potato, raw', grams: 220 },
    { foodQuery: 'Carrot, raw', grams: 100 },
  ],
]

const SNACKS: { foodQuery: string; grams: number }[][] = [
  [{ foodQuery: 'Whey protein isolate powder', grams: 30 }],
  [{ foodQuery: 'Apple, raw, with skin', grams: 180 }],
  [{ foodQuery: 'Peanut butter', grams: 32 }, { foodQuery: 'Bread, whole wheat', grams: 28 }],
]

export const DEMO_DAYS = 35

export function buildDemoPlan(now = Date.now(), seed = 7): DemoPlan {
  const random = pseudoRandom(seed)
  const days: DemoDay[] = []

  // ~0.45 kg/week down from 84, with ±0.6 kg of daily water-weight scatter on top.
  const startKg = 84
  const perDay = -0.45 / 7

  for (let offset = DEMO_DAYS - 1; offset >= 0; offset -= 1) {
    const at = now - offset * DAY_MS
    const index = DEMO_DAYS - 1 - offset

    // Two skipped log days and a few skipped weigh-ins: the algorithm has to cope with gaps,
    // and a demo where every day is complete hides whether it does.
    const skipLogging = index === 9 || index === 22
    const skipWeighIn = random() < 0.18

    const trend = startKg + perDay * index
    const weightKg = skipWeighIn ? null : Math.round((trend + (random() - 0.5) * 1.2) * 10) / 10

    const entries = skipLogging
      ? []
      : [
          ...pick(BREAKFASTS, random).map((e) => ({ ...e, meal: 'breakfast' as MealSlot })),
          ...pick(LUNCHES, random).map((e) => ({ ...e, meal: 'lunch' as MealSlot })),
          ...pick(DINNERS, random).map((e) => ({ ...e, meal: 'dinner' as MealSlot })),
          ...(random() < 0.7
            ? pick(SNACKS, random).map((e) => ({ ...e, meal: 'snack' as MealSlot }))
            : []),
        ]

    days.push({ day: dayKey(at), entries, weightKg })
  }

  return {
    days,
    program: { goal: 'lose', ratePctPerWeek: -0.5, proteinGPerKg: 1.8, fatMinPctKcal: 25 },
    profile: {
      heightCm: 180,
      birthYear: 1994,
      sex: 'male',
      dietNotes: 'No shellfish. Prefer chicken and fish over red meat.',
    },
  }
}

function pick<T>(options: T[][], random: () => number): T[] {
  return options[Math.floor(random() * options.length)] ?? []
}

/** Total kcal of a demo day, for asserting the fixture is in a sane range. */
export function demoDayKcal(day: DemoDay, kcalPerGram: (query: string) => number): number {
  return Math.round(day.entries.reduce((sum, e) => sum + kcalPerGram(e.foodQuery) * e.grams, 0))
}

export type { Nutrients }
