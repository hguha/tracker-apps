import { dayKey, dayKeyOffset } from '@tracker-engine/core'
import { db } from '@/db'
import {
  type Food,
  type LogEntry,
  type MealTemplate,
  type Nutrients,
  type Recipe,
} from '@/domain/types'
import { sum as sumNutrients } from '@/lib/nutrition'
import { queryTerms } from '@/lib/foodSearch'
import { entriesBetween, type LastAmount } from './entries'
import { foodsByIds } from './foods'
import { alive, byRecency, isPresent } from './internal'

/**
 * The user's own recipes and saved meals, matched by name.
 *
 * Because they were unfindable. Searching "lasagna soup" — a recipe the user had imported, named and
 * cooked twice — returned USDA's lasagna rows and not their own, and the only way to reach it was to
 * remember it existed and go to a different tab. A thing you saved is the *most* likely answer to
 * typing its name, so these rank above the database rather than beside it.
 *
 * Substring over every term, in any order, over the name only: an ingredient list is not a name, and
 * matching on it would make every recipe containing an onion a hit for "onion".
 */
export async function searchLibrary(query: string, limit = 8): Promise<LibraryHit[]> {
  const terms = queryTerms(query)
  if (terms.length === 0) return []

  const hits = (r: { name: string }) => terms.every((term) => r.name.toLowerCase().includes(term))
  const [recipeRows, templateRows] = await Promise.all([
    db.recipes.filter((row) => alive(row) && hits(row)).toArray(),
    db.mealTemplates.filter((row) => alive(row) && hits(row)).toArray(),
  ])

  const saved: LibraryHit[] = [
    ...recipeRows.map((recipe) => ({ kind: 'recipe' as const, recipe, name: recipe.name })),
    ...templateRows.map((template) => ({ kind: 'meal' as const, template, name: template.name })),
  ]

  // Dishes from the diary too, because a described meal is not saved anywhere: "3 steak tacos" was
  // eaten, named and re-loggable, and could only be reached by scrolling back to the day it was on.
  // Dropped where a recipe or saved meal already answers by that name — logging a recipe copies its
  // name onto every row, so the two would otherwise be the same answer twice.
  const named = new Set(saved.map((hit) => hit.name.toLowerCase()))
  const fromDiary = (await searchHistory(query, { limit })).flatMap((item): LibraryHit[] => {
    if (item.kind === 'food' || named.has(item.name.toLowerCase())) return []
    return item.kind === 'dish'
      ? [{ kind: 'dish' as const, dish: item, name: item.name }]
      : [{ kind: 'quick' as const, quick: item, name: item.name }]
  })

  return [...saved, ...fromDiary]
    // A name that *starts* with what was typed first, then alphabetically: with a handful of saved
    // things any stable order will do, and "starts with" is the one that feels like a search.
    .sort((a, b) => {
      const rank = (name: string) => (name.toLowerCase().startsWith(terms[0]!) ? 0 : 1)
      return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name)
    })
    .slice(0, limit)
}

export type LibraryHit =
  | { kind: 'recipe'; recipe: Recipe; name: string }
  | { kind: 'meal'; template: MealTemplate; name: string }
  | { kind: 'dish'; dish: RecentDish; name: string }
  | { kind: 'quick'; quick: RecentQuick; name: string }

/**
 * Things you have actually eaten, matched by name, going much further back than Recent shows.
 *
 * Recent holds thirty days and forty rows, which is the right size for a list you browse and the wrong
 * one for a question you ask: "carrot cake" was in the diary and unfindable, because the only way to
 * reach a past dish was to scroll to the day it was on. Searching what you've eaten is also the
 * *fastest* search there is — it's local, it's small, and it's far more likely to be the answer than
 * anything USDA has.
 *
 * Dishes are keyed by name here rather than by contents (`recentItems` does it by signature): for a
 * search, two slightly different lasagna soups are one answer, and the newest sitting is the one worth
 * re-logging.
 */
export async function searchHistory(
  query: string,
  { days = 180, limit = 8 }: { days?: number; limit?: number } = {},
): Promise<RecentItem[]> {
  const terms = queryTerms(query)
  if (terms.length === 0) return []

  const from = dayKeyOffset(Date.now(), days)
  const entries = await entriesBetween(from, dayKey(Date.now()))
  const foods = await foodsByIds(entries.map((entry) => entry.foodId).filter(isPresent))
  const hits = (text: string) => {
    const lower = text.toLowerCase()
    return terms.every((term) => lower.includes(term))
  }

  // One group per dish *name*, holding every sitting of it.
  const byName = new Map<string, Map<string, LogEntry[]>>()
  const byFood = new Map<string, { entry: LogEntry; times: number }>()
  const byQuick = new Map<string, { entry: LogEntry; times: number }>()
  for (const entry of entries) {
    if (entry.dishId !== null && entry.dishName !== null) {
      if (!hits(entry.dishName)) continue
      const key = entry.dishName.toLowerCase()
      const sittings = byName.get(key) ?? new Map<string, LogEntry[]>()
      sittings.set(entry.dishId, [...(sittings.get(entry.dishId) ?? []), entry])
      byName.set(key, sittings)
      continue
    }
    // A food that only ever arrived inside a dish is left out for the same reason it is in
    // `recentItems`: "Cheese, ricotta" is not something anybody logged, it came with the lasagna.
    if (entry.dishId !== null) continue
    if (entry.foodId === null) {
      const key = quickKey(entry)
      if (key === null || !hits(entry.note ?? '')) continue
      const current = byQuick.get(key)
      if (!current) byQuick.set(key, { entry, times: 1 })
      else {
        current.times += 1
        if (entry.eatenAt > current.entry.eatenAt) current.entry = entry
      }
      continue
    }
    const food = foods.get(entry.foodId)
    if (!food || !hits(food.description)) continue
    const current = byFood.get(entry.foodId)
    if (!current) byFood.set(entry.foodId, { entry, times: 1 })
    else {
      current.times += 1
      if (entry.eatenAt > current.entry.eatenAt) current.entry = entry
    }
  }

  const items: RecentItem[] = []
  for (const sittings of byName.values()) {
    const newest = [...sittings.values()].sort(
      (a, b) => Math.max(...b.map((r) => r.eatenAt)) - Math.max(...a.map((r) => r.eatenAt)),
    )[0]!
    const ordered = [...newest].sort((a, b) => a.sortIndex - b.sortIndex)
    items.push({
      kind: 'dish',
      dishId: ordered[0]!.dishId!,
      name: ordered[0]!.dishName ?? 'Dish',
      lastAt: Math.max(...ordered.map((row) => row.eatenAt)),
      times: sittings.size,
      nutrients: sumNutrients(ordered.map((row) => row.nutrients)),
      parts: ordered
        .map((row) => (row.foodId ? foods.get(row.foodId)?.description : null) ?? row.note)
        .filter(Boolean),
    })
  }
  for (const { entry, times } of byFood.values()) {
    const food = foods.get(entry.foodId!)
    if (!food) continue
    items.push({
      kind: 'food',
      food,
      lastAt: entry.eatenAt,
      times,
      amount:
        entry.grams > 0
          ? { grams: entry.grams, portionId: entry.portionId, portionCount: entry.portionCount }
          : null,
    })
  }
  for (const { entry, times } of byQuick.values()) {
    const quick = asQuick(entry, times)
    if (quick) items.push(quick)
  }

  return items.sort((a, b) => b.lastAt - a.lastAt).slice(0, limit)
}

/**
 * Distinct foods logged most often *on their own*, for the Log screen's frequents.
 *
 * Windowed rather than lifetime: this runs every time the Add food screen opens, and a food last
 * eaten eight months ago is not what "frequent" means to anyone. The `day` index makes it a range
 * scan instead of a walk over the whole history.
 *
 * Rows belonging to a dish are skipped. Counting them filled the list with things nobody logs by
 * itself — after three taco dinners, "Often" offered coriander, onion and sour cream, because each
 * had been written three times. The dish is already one row in `recentItems` with its own count; its
 * parts are an implementation detail of that row, not foods the user reaches for.
 */
export async function frequentFoodIds(limit = 20, days = 90): Promise<string[]> {
  const counts = new Map<string, number>()
  const from = dayKeyOffset(Date.now(), days)
  await db.logEntries
    .where('day')
    .aboveOrEqual(from)
    .filter(alive)
    .each((entry) => {
      if (entry.foodId && entry.dishId === null) {
        counts.set(entry.foodId, (counts.get(entry.foodId) ?? 0) + 1)
      }
    })
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id)
}

/**
 * What you have actually been eating, newest first — the list that should open when you tap "Log".
 *
 * This replaces a list keyed on `day|meal`, which was the app's worst piece of modelling. A
 * filing coordinate is not an identity, so eating the same lunch every weekday produced *eight
 * separate rows* — each labelled "Lunch · Tuesday", none naming a single food — and the list grew
 * forever instead of converging on the six things a real person eats.
 *
 * Keyed on **contents** instead: a dish's signature is its foods and their rounded amounts, so those
 * eight lunches become one row that says "8×". Single foods get a row each. A food that has only ever
 * been eaten as part of a dish is left out, because "Cheese, Ricotta" is not something anyone logs on
 * its own — it arrived inside the lasagna, and the lasagna is already in the list.
 */
interface RecentFood {
  kind: 'food'
  food: Food
  lastAt: number
  times: number
  amount: LastAmount | null
}

export interface RecentDish {
  kind: 'dish'
  /** The most recent sitting's id — what "log this again" re-logs. */
  dishId: string
  name: string
  lastAt: number
  times: number
  nutrients: Nutrients
  /** Food names in order, for a subtitle a person can recognise the dish by. */
  parts: string[]
}

export interface RecentQuick {
  kind: 'quick'
  name: string
  lastAt: number
  times: number
  nutrients: Nutrients
}

export type RecentItem = RecentFood | RecentDish | RecentQuick

const quickKey = (entry: LogEntry): string | null =>
  entry.quickAdd !== null && (entry.note ?? '').trim() !== ''
    ? `quick:${entry.note!.trim().toLowerCase()}`
    : null

function asQuick(entry: LogEntry, times: number): RecentQuick | null {
  if (quickKey(entry) === null) return null
  return {
    kind: 'quick',
    name: entry.note!.trim(),
    lastAt: entry.eatenAt,
    times,
    nutrients: entry.nutrients,
  }
}

export async function recentItems(days = 30, limit = 40): Promise<RecentItem[]> {
  const from = dayKeyOffset(Date.now(), days)
  /**
   * Oldest first, so "the latest one wins" is decided by position.
   *
   * See `byRecency` for why the tie-break matters.
   */
  const entries = (await entriesBetween(from, dayKey(Date.now()))).sort(byRecency)

  const dishRows = new Map<string, LogEntry[]>()
  const loose: LogEntry[] = []
  for (const entry of entries) {
    if (entry.dishId === null) loose.push(entry)
    else dishRows.set(entry.dishId, [...(dishRows.get(entry.dishId) ?? []), entry])
  }

  const foods = await foodsByIds([
    ...entries.map((entry) => entry.foodId).filter(isPresent),
  ])
  const nameOf = (entry: LogEntry): string =>
    (entry.foodId ? foods.get(entry.foodId)?.description : null) ?? entry.note ?? ''

  // Sittings collapsed by what they contained, so the same dinner counts rather than repeats.
  const bySignature = new Map<string, { rows: LogEntry[][]; lastAt: number; latest: string }>()
  for (const [dishId, rows] of dishRows) {
    const ordered = [...rows].sort((a, b) => a.sortIndex - b.sortIndex)
    const signature = [
      ordered[0]?.dishName ?? '',
      ...ordered.map((row) => `${row.foodId ?? row.recipeId ?? 'q'}:${Math.round(row.grams)}`).sort(),
    ].join('|')
    const lastAt = Math.max(...ordered.map((row) => row.eatenAt))
    const current = bySignature.get(signature)
    if (!current) bySignature.set(signature, { rows: [ordered], lastAt, latest: dishId })
    else {
      current.rows.push(ordered)
      if (lastAt > current.lastAt) {
        current.lastAt = lastAt
        current.latest = dishId
      }
    }
  }

  const dishes: RecentDish[] = [...bySignature.values()].map((group) => {
    const newest = group.rows.find((rows) => rows.some((row) => row.eatenAt === group.lastAt)) ?? group.rows[0]!
    return {
      kind: 'dish',
      dishId: group.latest,
      name: newest[0]?.dishName ?? 'Dish',
      lastAt: group.lastAt,
      times: group.rows.length,
      nutrients: sumNutrients(newest.map((row) => row.nutrients)),
      parts: newest.map(nameOf).filter(Boolean),
    }
  })

  const byFood = new Map<string, { entry: LogEntry; times: number }>()
  for (const entry of loose) {
    const key = entry.foodId ?? quickKey(entry)
    if (key === null) continue
    const current = byFood.get(key)
    if (!current) byFood.set(key, { entry, times: 1 })
    else {
      current.times += 1
      current.entry = entry
    }
  }

  const items: RecentItem[] = [...dishes]
  for (const { entry, times } of byFood.values()) {
    const food = entry.foodId ? foods.get(entry.foodId) : undefined
    if (!food) {
      const quick = asQuick(entry, times)
      if (quick) items.push(quick)
      continue
    }
    items.push({
      kind: 'food',
      food,
      lastAt: entry.eatenAt,
      times,
      amount: entry.grams > 0
        ? { grams: entry.grams, portionId: entry.portionId, portionCount: entry.portionCount }
        : null,
    })
  }

  return items.sort((a, b) => b.lastAt - a.lastAt).slice(0, limit)
}
