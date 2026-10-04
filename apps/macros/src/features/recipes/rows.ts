import { portionFor } from '@/lib/nutrition'
import { resolveAmount } from '@/lib/resolveAmount'
import type { ParsedIngredient } from '@/lib/parseIngredient'
import type { Food, Recipe } from '@/domain/types'

export interface Row {
  key: string
  foodId: string | null
  label: string
  query: string
  grams: number
  amount?: string | null
  parsed?: ParsedIngredient
  needsWeight?: boolean
  isMatching?: boolean
}

let nextKey = 0
export const rowKey = (): string => `row-${(nextKey += 1)}`

export const rowFromFood = (food: Food | null, query: string, grams: number): Row => ({
  key: rowKey(),
  foodId: food?.id ?? null,
  label: food?.description ?? query,
  query,
  grams,
})

export function rowForPick(food: Food): Row {
  const portion = portionFor(food, null)
  return rowFromFood(food, food.description, portion ? Math.round(portion.grams) : 100)
}

export function repointRow(row: Row, food: Food): Row {
  const weighed = row.parsed ? resolveAmount(row.parsed, food).grams : null
  return {
    ...row,
    foodId: food.id,
    label: food.description,
    grams: weighed ?? (row.grams > 0 ? row.grams : 100),
    needsWeight: false,
  }
}

export function recipeGrams(recipe: Recipe): number {
  return recipe.ingredients
    .filter((ingredient) => !ingredient.optional)
    .reduce((total, ingredient) => total + ingredient.grams, 0)
}

export function rowsFromRecipe(recipe: Recipe, share = 1 / Math.max(1, recipe.servings)): Row[] {
  return recipe.ingredients
    .filter((ingredient) => !ingredient.optional)
    .map((ingredient) => ({
      key: rowKey(),
      foodId: ingredient.foodId,
      label: ingredient.label,
      query: ingredient.label,
      grams: Math.round(ingredient.grams * share),
      amount: null,
    }))
}

export const rowsFromSaved = (recipe: Recipe): Row[] =>
  recipe.ingredients.map((ingredient) => ({
    key: rowKey(),
    foodId: ingredient.foodId,
    label: ingredient.label,
    query: ingredient.label,
    grams: ingredient.grams,
    amount: ingredient.amount ?? null,
  }))
