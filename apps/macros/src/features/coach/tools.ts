import type { ToolDeclaration } from '@tracker-engine/ai-coach'
import { DAY_MS, dayKey } from '@tracker-engine/core'
import { trendChangePerWeek, weightTrend } from '@tracker-engine/body'
import * as repo from '@/data/repository'
import { dayTotals, mgToGrams, nutrientsFor, remaining } from '@/lib/nutrition'
import { dayTiming, eatingOccasions, formatClock, minutesIntoDay, windowState } from '@/lib/mealTiming'
import type { CoachAction } from './types'
import { MEAL_SLOTS, type MealSlot } from '@/domain/types'

/**
 * What the coach may look up, and what it may propose.
 *
 * Retrieval tools run locally against IndexedDB, so the model never receives a bulk dump of
 * the user's history — it asks for exactly what it needs, and only summaries leave the device.
 * Action tools are terminal: they end the turn with a card the user confirms.
 */

const ACTION_TOOLS = new Set(['logFood', 'suggestMeal'])

export const isActionTool = (name: string): boolean => ACTION_TOOLS.has(name)

export const TOOL_DECLARATIONS: ToolDeclaration[] = [
  {
    name: 'getToday',
    description:
      "Today's calorie and macro totals, the current targets, what's left, and when the user has eaten so far (with their eating window and how long they have been fasting, if they keep one). Use before any advice about what or when to eat next.",
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'getRecentDays',
    description:
      'Daily calorie and macro totals for the last N days (max 30), with how many separate eating occasions each day had and when the first and last were.',
    parameters: {
      type: 'object',
      properties: { days: { type: 'integer', description: 'How many days back, 1-30.' } },
      required: ['days'],
    },
  },
  {
    name: 'getWeightTrend',
    description:
      'Smoothed bodyweight trend and its rate of change per week. The trend, not raw weigh-ins, is what decisions use.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'getProgram',
    description:
      'The current goal, target rate, protein floor, measured expenditure and its error bar.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'searchFoods',
    description:
      'Search the food database by name. Required before logging or suggesting anything: every gram must come from a real food row.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'integer' } },
      required: ['query'],
    },
  },
  {
    name: 'logFood',
    description:
      'Propose logging a food the user has confirmed they ate. Call searchFoods first to get a foodId.',
    parameters: {
      type: 'object',
      properties: {
        foodId: { type: 'string' },
        grams: { type: 'number' },
        meal: { type: 'string', enum: [...MEAL_SLOTS] },
      },
      required: ['foodId', 'grams', 'meal'],
    },
  },
  {
    name: 'suggestMeal',
    description:
      'Propose a meal that fits the remaining macros. Every item needs a foodId from searchFoods.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        note: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { foodId: { type: 'string' }, grams: { type: 'number' } },
            required: ['foodId', 'grams'],
          },
        },
      },
      required: ['title', 'items'],
    },
  },
]

export function toolLabel(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'getToday':
      return 'Checking today'
    case 'getRecentDays':
      return `Reading the last ${String(args.days ?? '')} days`
    case 'getWeightTrend':
      return 'Reading your weight trend'
    case 'getProgram':
      return 'Checking your targets'
    case 'searchFoods':
      return `Looking up "${String(args.query ?? '')}"`
    default:
      return 'Thinking'
  }
}

export async function executeRetrievalTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case 'getToday': {
      const day = dayKey(Date.now())
      const entries = await repo.entriesForDay(day)
      const totals = dayTotals(entries)
      const targets = await repo.currentTargets()
      const window = (await repo.getProfile()).eatingWindow
      const state = window ? windowState(window, entries) : null

      return {
        day,
        eaten: describe(totals),
        targets: targets && {
          kcal: targets.kcal,
          proteinG: Math.round(mgToGrams(targets.proteinMg)),
          carbsG: Math.round(mgToGrams(targets.carbsMg)),
          fatG: Math.round(mgToGrams(targets.fatMg)),
        },
        left: targets ? describe(remaining(totals, targets)) : null,
        now: formatClock(minutesIntoDay(Date.now())),
        occasions: eatingOccasions(entries).map((occasion) => ({
          at: formatClock(minutesIntoDay(occasion.startAt)),
          meal: occasion.entries[0]!.meal,
          kcal: occasion.nutrients.kcal,
        })),
        eatingWindow: window
          ? `${formatClock(window.startMinute)}-${formatClock(window.endMinute)}`
          : null,
        windowPhase: state?.phase ?? null,
        fastedMinutes: state?.fastedMinutes ?? null,
      }
    }

    case 'getRecentDays': {
      const days = Math.min(30, Math.max(1, Number(args.days) || 7))
      const from = dayKey(Date.now() - days * DAY_MS)
      const entries = await repo.entriesBetween(from, dayKey(Date.now()))
      const byDay = new Map<string, typeof entries>()
      for (const entry of entries) {
        byDay.set(entry.day, [...(byDay.get(entry.day) ?? []), entry])
      }
      return [...byDay.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([day, rows]) => {
          const timing = dayTiming(rows)
          return {
            day,
            ...describe(dayTotals(rows)),
            occasions: timing.occasions,
            firstAt: timing.firstAt === null ? null : formatClock(minutesIntoDay(timing.firstAt)),
            lastAt: timing.lastAt === null ? null : formatClock(minutesIntoDay(timing.lastAt)),
          }
        })
    }

    case 'getWeightTrend': {
      const trend = weightTrend(await repo.weights())
      const latest = trend[trend.length - 1]
      return {
        latestKg: latest?.kg ?? null,
        trendKg: latest ? Number(latest.trendKg.toFixed(2)) : null,
        kgPerWeek: Number((trendChangePerWeek(trend) ?? 0).toFixed(2)),
        weighIns: trend.length,
      }
    }

    case 'getProgram': {
      const program = await repo.activeProgram()
      const checkIn = await repo.latestCheckIn()
      return {
        goal: program?.goal ?? null,
        ratePctPerWeek: program?.ratePctPerWeek ?? null,
        proteinGPerKg: program?.proteinGPerKg ?? null,
        coachingMode: program?.coachingMode ?? null,
        expenditureKcal: checkIn?.expenditureKcal ?? null,
        expenditureSe: checkIn?.expenditureSe ?? null,
      }
    }

    case 'searchFoods': {
      const limit = Math.min(15, Math.max(1, Number(args.limit) || 8))
      const foods = await repo.searchFoods(String(args.query ?? ''), limit)
      return foods.map((food) => ({
        foodId: food.id,
        description: food.description,
        brand: food.brand,
        per100: describe(food.per100),
        portions: food.portions.map((p) => ({ label: p.label, grams: p.grams })),
      }))
    }

    default:
      throw new Error(`Unknown tool "${name}"`)
  }
}

/**
 * Builds the confirmation card. Macros are computed here from the matched food rows — the
 * model supplies ids and grams and nothing else, so a hallucinated calorie count can't reach
 * the log. An unmatched id yields null, which ends the turn as plain text instead.
 */
export async function toolToAction(
  name: string,
  args: Record<string, unknown>,
): Promise<CoachAction | null> {
  if (name === 'logFood') {
    const food = await repo.getFood(String(args.foodId ?? ''))
    const grams = Number(args.grams)
    if (!food || !Number.isFinite(grams) || grams <= 0) return null
    const meal = MEAL_SLOTS.includes(args.meal as MealSlot) ? (args.meal as MealSlot) : 'snack'
    return {
      kind: 'log-food',
      foodId: food.id,
      description: food.description,
      grams,
      meal,
      nutrients: nutrientsFor(food, grams),
    }
  }

  if (name === 'suggestMeal') {
    const raw = Array.isArray(args.items) ? args.items : []
    const items: { foodId: string; description: string; grams: number }[] = []
    const parts = []
    for (const entry of raw) {
      const item = entry as { foodId?: unknown; grams?: unknown }
      const food = await repo.getFood(String(item.foodId ?? ''))
      const grams = Number(item.grams)
      if (!food || !Number.isFinite(grams) || grams <= 0) continue
      items.push({ foodId: food.id, description: food.description, grams })
      parts.push(nutrientsFor(food, grams))
    }
    if (items.length === 0) return null
    return {
      kind: 'suggest-meal',
      title: String(args.title ?? 'A meal'),
      note: String(args.note ?? ''),
      items,
      nutrients: dayTotals(parts.map((nutrients) => ({ nutrients }))),
    }
  }

  return null
}

/** Grams, not milligrams, for the model: mg reads as a suspiciously large number to an LLM. */
function describe(n: {
  kcal: number
  proteinMg: number
  carbsMg: number
  fatMg: number
  fiberMg?: number | null
}) {
  return {
    kcal: n.kcal,
    proteinG: Math.round(mgToGrams(n.proteinMg)),
    carbsG: Math.round(mgToGrams(n.carbsMg)),
    fatG: Math.round(mgToGrams(n.fatMg)),
    ...(n.fiberMg != null && { fiberG: Math.round(mgToGrams(n.fiberMg)) }),
  }
}
