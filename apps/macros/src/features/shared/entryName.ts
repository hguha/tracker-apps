import type { Food, LogEntry } from '@/domain/types'

/**
 * What to call a log entry on screen.
 *
 * One implementation because the fallback order is a real decision, not formatting: the food row's
 * name if it's cached, then whatever the entry recorded (a described item's own words, a recipe
 * name, a quick-add label), and only then a generic word. Three screens had their own copy.
 */
export function entryName(entry: LogEntry, foods: ReadonlyMap<string, Food>): string {
  if (entry.foodId) return foods.get(entry.foodId)?.description ?? (entry.note || 'Food')
  return entry.note || 'Quick add'
}

/**
 * Every name a row can be found by: the food, the dish it was entered as, and what was typed.
 *
 * Searching History for "lasagna soup" found nothing, because the rows are named after their *foods*
 * — "Chicken breast", "Tomato" — and the name the user actually gave the meal lived in `dishName`,
 * which nothing looked at. A diary you can't search by the words you used is a diary you can't search.
 */
export function searchableNames(entry: LogEntry, foods: ReadonlyMap<string, Food>): string {
  return [entryName(entry, foods), entry.dishName, entry.note].filter(Boolean).join(' ')
}

/** The food ids on a set of entries, for one bulk lookup instead of a query per row. */
export function foodIdsOf(entries: readonly LogEntry[]): string[] {
  return entries.map((entry) => entry.foodId).filter((id): id is string => id !== null)
}
