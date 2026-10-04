import { db } from '@/db'
import { patch } from '@/data/outbox'
import type { LogEntry, Nutrients } from '@/domain/types'
import { scale as scaleNutrients, servingsIn } from '@/lib/nutrition'
import { getFood, saveCustomFood } from './foods'
import { getRecipe, saveRecipe } from './recipes'
import { alive } from './internal'

interface RecipePart {
  foodId: string | null
  recipeId?: string | null
  grams: number
  nutrients: Nutrients
  label?: string | null
}

const QUICK_GRAMS = 100

async function ingredientsFrom(parts: readonly RecipePart[]) {
  const ingredients: { foodId: string; label: string; grams: number }[] = []
  for (const part of parts) {
    if (part.foodId) {
      const food = await getFood(part.foodId)
      ingredients.push({
        foodId: part.foodId,
        label: food?.description ?? part.label ?? 'Food',
        grams: part.grams,
      })
      continue
    }
    if (part.recipeId) {
      const recipe = await getRecipe(part.recipeId)
      if (!recipe) continue
      const share = servingsIn(part.nutrients, recipe) / Math.max(1, recipe.servings)
      for (const row of recipe.ingredients) {
        if (row.foodId && !row.optional) {
          ingredients.push({ foodId: row.foodId, label: row.label, grams: row.grams * share })
        }
      }
      continue
    }
    const label = part.label?.trim() || 'Calories only'
    const foodId = await saveCustomFood({
      description: label,
      per100: scaleNutrients(part.nutrients, 1),
      servingGrams: QUICK_GRAMS,
      servingLabel: '1 serving',
    })
    ingredients.push({ foodId, label, grams: QUICK_GRAMS })
  }
  return ingredients
}

export async function saveRecipeFromParts(
  name: string,
  parts: readonly RecipePart[],
  servings = 1,
  id?: string,
): Promise<string> {
  return saveRecipe(
    { name: name.trim() || 'Recipe', servings, ingredients: await ingredientsFrom(parts) },
    id,
  )
}

export function saveRecipeFromEntries(name: string, entries: readonly LogEntry[]): Promise<string> {
  return saveRecipeFromParts(
    name,
    entries.map((entry) => ({
      foodId: entry.foodId,
      recipeId: entry.recipeId,
      grams: entry.grams,
      nutrients: entry.quickAdd ?? entry.nutrients,
      label: entry.note,
    })),
  )
}

let migrating: Promise<number> | null = null

export function migrateSavedMeals(): Promise<number> {
  migrating ??= convertSavedMeals().finally(() => {
    migrating = null
  })
  return migrating
}

async function convertSavedMeals(): Promise<number> {
  const templates = await db.mealTemplates.filter(alive).toArray()
  for (const template of templates) {
    if (!(await db.recipes.get(template.id))) {
      await saveRecipeFromParts(
        template.name,
        template.items.map((item) => ({ ...item, label: template.name })),
        1,
        template.id,
      )
    }
    await patch('mealTemplates', template.id, { deletedAt: Date.now() })
  }
  return templates.length
}
