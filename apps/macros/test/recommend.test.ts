import { describe, expect, it } from 'vitest'
import { recommendRecipes, servingsThatFit } from '@/lib/recommend'
import { gramsToMg } from '@/lib/nutrition'
import { EMPTY_NUTRIENTS, type CuisineKey, type Recipe, type RecipeUsage } from '@/domain/types'

const TODAY = '2026-09-08'

function recipe(
  id: string,
  options: {
    kcal: number
    proteinG?: number
    servings?: number
    cuisine?: CuisineKey | null
  },
): Recipe {
  const servings = options.servings ?? 4
  return {
    id,
    userId: 'u',
    name: id,
    servings,
    yieldGrams: null,
    ingredients: [],
    steps: [],
    tags: [],
    cuisine: options.cuisine ?? null,
    totalMinutes: null,
    sourceUrl: null,
    authoredBy: 'user',
    // Stored as the whole-recipe total; perServing divides by `servings`.
    nutrients: {
      ...EMPTY_NUTRIENTS,
      kcal: options.kcal * servings,
      proteinMg: gramsToMg((options.proteinG ?? 20) * servings),
    },
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    clientRev: 1,
  }
}

const usage = (rows: Record<string, RecipeUsage>): Map<string, RecipeUsage> =>
  new Map(Object.entries(rows))

describe('servingsThatFit', () => {
  it('rounds to a half, because portions are how a batch dish is eaten', () => {
    expect(servingsThatFit(300, 800)).toBe(2.5)
    expect(servingsThatFit(400, 500)).toBe(1)
  })

  it('never proposes less than half a portion, even when the budget is tiny', () => {
    expect(servingsThatFit(600, 100)).toBe(0.5)
  })

  it('is one serving when there is no target to fit', () => {
    expect(servingsThatFit(500, null)).toBe(1)
  })
})

describe('recommendRecipes', () => {
  const base = {
    remainingKcal: 700,
    remainingProteinMg: gramsToMg(50),
    usage: usage({}),
    recentCuisines: [],
    today: TODAY,
  }

  it('prefers the protein-dense dish when protein is still owed', () => {
    const rows = recommendRecipes({
      ...base,
      recipes: [
        recipe('chicken', { kcal: 700, proteinG: 60 }),
        recipe('pasta', { kcal: 700, proteinG: 12 }),
      ],
    })
    expect(rows[0]!.recipe.id).toBe('chicken')
    expect(rows[0]!.why).toContain('g protein')
  })

  it('demotes something eaten today, and says why the other one is up', () => {
    const rows = recommendRecipes({
      ...base,
      remainingProteinMg: 0,
      recipes: [recipe('chilli', { kcal: 700 }), recipe('dhal', { kcal: 700 })],
      usage: usage({ chilli: { timesCooked: 9, lastCookedDay: TODAY } }),
    })
    // Nine times cooked is the strongest favourite signal there is, and freshness still wins.
    expect(rows[0]!.recipe.id).toBe('dhal')
  })

  it('penalises a cuisine that dominates the recent window', () => {
    const rows = recommendRecipes({
      ...base,
      remainingProteinMg: 0,
      recipes: [
        recipe('ragu', { kcal: 700, cuisine: 'italian' }),
        recipe('dhal', { kcal: 700, cuisine: 'indian' }),
      ],
      recentCuisines: ['italian', 'italian', 'italian', 'italian'],
    })
    expect(rows[0]!.recipe.id).toBe('dhal')
  })

  it('honours a cuisine filter absolutely', () => {
    const rows = recommendRecipes({
      ...base,
      recipes: [
        recipe('ragu', { kcal: 700, cuisine: 'italian' }),
        recipe('dhal', { kcal: 700, cuisine: 'indian' }),
      ],
      cuisine: 'indian',
    })
    expect(rows.map((row) => row.recipe.id)).toEqual(['dhal'])
  })

  it('still ranks without a calorie target, on cooking history alone', () => {
    const rows = recommendRecipes({
      ...base,
      remainingKcal: null,
      remainingProteinMg: 0,
      recipes: [recipe('a', { kcal: 400 }), recipe('b', { kcal: 900 })],
      usage: usage({ b: { timesCooked: 5, lastCookedDay: '2026-08-01' } }),
    })
    expect(rows[0]!.recipe.id).toBe('b')
  })

  it('scales the reported nutrients by the servings it proposes', () => {
    const rows = recommendRecipes({
      ...base,
      recipes: [recipe('soup', { kcal: 350, proteinG: 30 })],
    })
    expect(rows[0]!.servings).toBe(2)
    expect(rows[0]!.nutrients.kcal).toBe(700)
  })

  it('drops a recipe with no calories rather than ranking it at the top', () => {
    const rows = recommendRecipes({
      ...base,
      recipes: [recipe('empty', { kcal: 0, proteinG: 0 }), recipe('real', { kcal: 700 })],
    })
    expect(rows.map((row) => row.recipe.id)).toEqual(['real'])
  })
})
