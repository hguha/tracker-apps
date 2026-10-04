import { dayKey } from '@tracker-engine/core'
import { syncStamp } from '@tracker-engine/local-first'
import { db } from '@/db'
import { enqueue, newId, patch } from '@/data/outbox'
import {
  type LogEntry,
  type MealSlot,
  type MealTemplate,
  type MealTemplateItem,
  type Nutrients,
  type Venue,
} from '@/domain/types'
import { scale as scaleNutrients, sum as sumNutrients } from '@/lib/nutrition'
import { activeUserId, alive, nextSortIndex } from './internal'

export function mealTemplates(): Promise<MealTemplate[]> {
  return db.mealTemplates.filter(alive).toArray()
}

/**
 * Saves a set of logged entries as a meal to repeat.
 *
 * Nutrients are copied onto the template, not re-derived from the food ids: a saved meal has to
 * keep working when a food row is never re-fetched on a new device, and re-deriving would also
 * let a reference-data correction silently change what "my usual breakfast" means.
 */
export async function saveMealTemplate(
  name: string,
  entries: readonly LogEntry[],
): Promise<string> {
  return saveMealFromParts(
    name,
    entries.map((entry) => ({
      foodId: entry.foodId,
      recipeId: entry.recipeId,
      grams: entry.grams,
      nutrients: entry.nutrients,
    })),
  )
}

interface MealPart {
  foodId: string | null
  recipeId?: string | null
  grams: number
  nutrients: Nutrients
}

/**
 * Saves a set of foods as a meal, optionally divided down to one of something.
 *
 * `perUnit` is why this exists. "3 steak tacos" resolves to six foods at the amounts for three tacos,
 * and saving *that* means having one tomorrow needs either mental arithmetic or a second near-identical
 * saved meal. Divided by the count, one taco is what's stored — and 1, 3 or 5 of them are all a
 * multiple away, which `logMealTemplate` already takes.
 */
export async function saveMealFromParts(
  name: string,
  parts: readonly MealPart[],
  perUnit = 1,
): Promise<string> {
  const share = 1 / Math.max(1, perUnit)
  const items: MealTemplateItem[] = parts.map((part) => ({
    id: newId(),
    foodId: part.foodId,
    recipeId: part.recipeId ?? null,
    grams: part.grams * share,
    nutrients: scaleNutrients(part.nutrients, share),
  }))
  const template: MealTemplate = {
    id: newId(),
    userId: activeUserId,
    name: name.trim() || 'Saved meal',
    items,
    nutrients: sumNutrients(items.map((item) => item.nutrients)),
    ...syncStamp(),
  }
  await db.mealTemplates.put(template)
  await enqueue('mealTemplates', template.id)
  return template.id
}

/** A saved meal's default name is a date, so renaming it is what makes the list usable. */
export function renameMealTemplate(id: string, name: string): Promise<void> {
  return patch('mealTemplates', id, { name: name.trim() || 'Saved meal' })
}

export function deleteMealTemplate(id: string): Promise<void> {
  return patch('mealTemplates', id, { deletedAt: Date.now() })
}

/**
 * Logs a saved meal, optionally at a fraction or multiple of the saved amount.
 *
 * The multiplier is what makes a saved meal cover batch cooking: save the whole tray, then log a
 * third of it. Grams and nutrients scale together through lib/nutrition, so a half portion can't
 * end up with full-portion macros.
 */
export async function logMealTemplate(
  template: MealTemplate,
  meal: MealSlot,
  at = Date.now(),
  multiple = 1,
  // Home by default, like every other write path — see `LogScreen` on why the default beats null.
  venue: Venue | null = 'home',
): Promise<number> {
  const dishId = newId()
  for (const item of template.items) {
    const entry: LogEntry = {
      id: newId(),
      userId: activeUserId,
      day: dayKey(at),
      eatenAt: at,
      meal,
      sortIndex: nextSortIndex(at),
      foodId: item.foodId,
      recipeId: item.recipeId,
      fromRecipeId: null,
      dishId,
      dishName: template.name,
      quickAdd:
        item.foodId === null && item.recipeId === null
          ? scaleNutrients(item.nutrients, multiple)
          : null,
      grams: item.grams * multiple,
      portionId: null,
      portionCount: null,
      nutrients: scaleNutrients(item.nutrients, multiple),
      source: 'template',
      estimate: null,
      venue,
      note: template.name,
      ...syncStamp(),
    }
    await db.logEntries.put(entry)
    await enqueue('logEntries', entry.id)
  }
  return template.items.length
}
