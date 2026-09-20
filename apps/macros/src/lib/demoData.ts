import { DAY_MS, dayKey } from '@tracker-engine/core'
import type { CuisineKey, MealSlot, Nutrients, Venue } from '@/domain/types'

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
  /** A recipe cooked that evening, in place of an assembled dinner. */
  cook: { recipe: string; servings: number } | null
  /** Where dinner was eaten. Home most nights — the rest is what makes the pattern worth charting. */
  dinnerVenue: Venue
  /** Water for the day, in ml. Some days short, because nobody hits it every day. */
  waterMl: number
  weightKg: number | null
}

export interface DemoRecipe {
  name: string
  cuisine: CuisineKey
  servings: number
  totalMinutes: number
  steps: string[]
  /** `amount` is what the recipe says; `grams` is what gets stored. Both, because a cook reads one
   *  and the arithmetic needs the other. */
  ingredients: { foodQuery: string; grams: number; amount: string }[]
}

export interface DemoPlan {
  days: DemoDay[]
  recipes: DemoRecipe[]
  program: { goal: 'lose'; ratePctPerWeek: number; proteinGPerKg: number; fatMinPctKcal: number }
  profile: { heightCm: number; birthYear: number; sex: 'male'; dietNotes: string }
}

/**
 * When each meal happens.
 *
 * Every demo row used to be stamped at noon, which made the meal-timing chart a single spike at
 * midday and the eating window meaningless — the two things on the Habits tab that are *about* time.
 */
export const MEAL_MINUTE: Record<MealSlot, number> = {
  breakfast: 8 * 60 + 10,
  lunch: 12 * 60 + 40,
  dinner: 19 * 60 + 20,
  snack: 16 * 60,
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

/**
 * Three things the demo cooks.
 *
 * Without them the library is empty, "what you cook" has nothing to rank, and the cuisine mix is a
 * blank card — so a screenshot of any of those showed the empty state rather than the feature. Every
 * food is named exactly as `db/seed/staples.ts` has it, which is why that file is hand-written.
 */
export const DEMO_RECIPES: DemoRecipe[] = [
  {
    name: 'Sunday chilli',
    cuisine: 'mexican',
    servings: 4,
    totalMinutes: 55,
    ingredients: [
      { foodQuery: 'Ground beef, 90% lean, raw', grams: 450, amount: '1 lb' },
      { foodQuery: 'Black beans, cooked', grams: 400, amount: '2 cups' },
      { foodQuery: 'Tomato, raw', grams: 400, amount: '4 tomatoes' },
      { foodQuery: 'Onion, raw', grams: 150, amount: '1 large onion' },
      { foodQuery: 'Bell pepper, red, raw', grams: 120, amount: '1 pepper' },
      { foodQuery: 'Olive oil', grams: 14, amount: '1 tbsp' },
    ],
    steps: [
      'Soften the onion and pepper in the oil, about eight minutes.',
      'Turn the heat up, add the beef and brown it properly.',
      'Add the tomatoes and beans, then simmer uncovered for half an hour.',
      'Season hard at the end. It is better the next day.',
    ],
  },
  {
    name: 'Salmon traybake',
    cuisine: 'mediterranean',
    servings: 2,
    totalMinutes: 35,
    ingredients: [
      { foodQuery: 'Salmon, Atlantic, raw', grams: 340, amount: '2 fillets' },
      { foodQuery: 'Potato, russet, raw', grams: 500, amount: '2 potatoes' },
      { foodQuery: 'Broccoli, raw', grams: 200, amount: '1 small head' },
      { foodQuery: 'Olive oil', grams: 28, amount: '2 tbsp' },
    ],
    steps: [
      'Halve the potatoes, toss in half the oil, roast at 220°C for 20 minutes.',
      'Add the broccoli and the salmon, skin down, with the rest of the oil.',
      'Back in for 12 minutes, until the salmon just flakes.',
    ],
  },
  {
    name: 'Chicken and rice bowls',
    cuisine: 'korean',
    servings: 4,
    totalMinutes: 30,
    ingredients: [
      { foodQuery: 'Chicken thigh, skinless, raw', grams: 600, amount: '1.3 lb' },
      { foodQuery: 'Rice, white, long-grain, cooked', grams: 700, amount: '4 cups cooked' },
      { foodQuery: 'Broccoli, raw', grams: 250, amount: '1 head' },
      { foodQuery: 'Carrot, raw', grams: 120, amount: '2 carrots' },
      { foodQuery: 'Olive oil', grams: 14, amount: '1 tbsp' },
    ],
    steps: [
      'Cut the thigh into strips and fry hard in the oil until the edges catch.',
      'Steam the broccoli and carrot for four minutes, no longer.',
      'Build the bowls over the rice, and keep the pan juices.',
    ],
  },
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

    // Roughly every fourth evening is cooked from a recipe rather than assembled from parts, which
    // is also the only way the log has dishes in it.
    const cook =
      !skipLogging && index % 4 === 1
        ? { recipe: DEMO_RECIPES[Math.floor(index / 4) % DEMO_RECIPES.length]!.name, servings: 1 }
        : null

    const entries = skipLogging
      ? []
      : [
          ...pick(BREAKFASTS, random).map((e) => ({ ...e, meal: 'breakfast' as MealSlot })),
          ...pick(LUNCHES, random).map((e) => ({ ...e, meal: 'lunch' as MealSlot })),
          ...(cook
            ? []
            : pick(DINNERS, random).map((e) => ({ ...e, meal: 'dinner' as MealSlot }))),
          ...(random() < 0.7
            ? pick(SNACKS, random).map((e) => ({ ...e, meal: 'snack' as MealSlot }))
            : []),
        ]

    // Four nights out and two takeaways across five weeks. A diary where every meal is "home" can't
    // show whether eating out is what moves the week.
    const dinnerVenue: Venue = cook
      ? 'home'
      : index % 9 === 4
        ? 'restaurant'
        : index % 11 === 7
          ? 'takeaway'
          : 'home'

    // Roughly two litres, give or take a bottle, and nothing at all on the two unlogged days —
    // otherwise the water card and its chart are empty on every screen that shows them.
    const waterMl = skipLogging ? 0 : 1200 + Math.round(random() * 4) * 250

    days.push({ day: dayKey(at), entries, cook, dinnerVenue, waterMl, weightKg })
  }

  return {
    days,
    recipes: DEMO_RECIPES,
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
