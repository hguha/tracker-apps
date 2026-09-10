import { sum } from '@/lib/nutrition'
import { MEAL_SLOTS, type LogEntry, type MealSlot, type Nutrients } from '@/domain/types'

/**
 * How a day is broken up on screen: by meal, then by dish.
 *
 * The day screen used to group by a **45-minute gap in the clock** and then label each group with the
 * meal slot of its first row. Two unrelated models, and the user was asked to maintain the one that
 * wasn't used for grouping — so logging four things across a long afternoon produced four cards all
 * headed "Lunch", and a snack eaten twenty minutes after lunch silently disappeared into it. Meal
 * slots are what the user sets, what every other tracker groups by, and the only grouping that can't
 * surprise them.
 *
 * Clock-gap grouping still exists in `lib/mealTiming` and still earns its place — it is the right
 * model for *timing* questions ("five small occasions or one big one"), which is an Insights
 * question. It is the wrong model for a diary.
 */

export interface DishGroup {
  /** Null for a food logged on its own, which is most rows. */
  dishId: string | null
  name: string | null
  entries: LogEntry[]
  nutrients: Nutrients
}

export interface MealGroup {
  meal: MealSlot
  entries: LogEntry[]
  dishes: DishGroup[]
  nutrients: Nutrients
  firstAt: number
}

export function mealGroups(entries: readonly LogEntry[]): MealGroup[] {
  const bySlot = new Map<MealSlot, LogEntry[]>()
  for (const entry of entries) {
    bySlot.set(entry.meal, [...(bySlot.get(entry.meal) ?? []), entry])
  }

  return MEAL_SLOTS.flatMap((meal) => {
    const rows = bySlot.get(meal)
    if (!rows || rows.length === 0) return []
    const ordered = [...rows].sort((a, b) => a.sortIndex - b.sortIndex || a.eatenAt - b.eatenAt)
    return [
      {
        meal,
        entries: ordered,
        dishes: dishGroups(ordered),
        nutrients: sum(ordered.map((entry) => entry.nutrients)),
        firstAt: ordered[0]!.eatenAt,
      },
    ]
  })
}

/**
 * Rows grouped into the dishes they were entered as, in the order they were logged.
 *
 * A `null` dishId is its own group of one, never merged with other loose rows: two separate foods are
 * two things you ate, and pooling them would invent a dish nobody named.
 */
export function dishGroups(entries: readonly LogEntry[]): DishGroup[] {
  const out: DishGroup[] = []
  const byId = new Map<string, DishGroup>()

  for (const entry of entries) {
    if (entry.dishId === null) {
      out.push({
        dishId: null,
        name: null,
        entries: [entry],
        nutrients: entry.nutrients,
      })
      continue
    }
    const existing = byId.get(entry.dishId)
    if (existing) {
      existing.entries.push(entry)
      existing.nutrients = sum(existing.entries.map((row) => row.nutrients))
      continue
    }
    const group: DishGroup = {
      dishId: entry.dishId,
      name: entry.dishName,
      entries: [entry],
      nutrients: entry.nutrients,
    }
    byId.set(entry.dishId, group)
    out.push(group)
  }

  return out
}
