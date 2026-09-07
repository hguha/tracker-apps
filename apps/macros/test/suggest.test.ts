import { describe, expect, it } from 'vitest'
import { suggestFoods } from '@/lib/suggest'
import { gramsToMg } from '@/lib/nutrition'
import { EMPTY_NUTRIENTS, type Food } from '@/domain/types'

function food(description: string, kcal: number, proteinG: number): Food {
  return {
    id: `usda:${description}`,
    source: 'usda',
    description,
    brand: null,
    barcode: null,
    category: null,
    dataType: 'foundation',
    per100: { ...EMPTY_NUTRIENTS, kcal, proteinMg: gramsToMg(proteinG) },
    gramsPerMl: null,
    portions: [],
    verifiedAt: null,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    clientRev: 1,
  }
}

const targets = (kcal: number, proteinG: number) => ({
  kcal,
  proteinMg: gramsToMg(proteinG),
  carbsMg: 0,
  fatMg: 0,
})

describe('suggestFoods', () => {
  const candidates = [
    food('Chicken breast', 165, 31),
    food('Olive oil', 884, 0),
    food('White rice', 130, 2.7),
  ]

  it('leads with protein density when protein is still owed', () => {
    const suggestions = suggestFoods(targets(600, 40), candidates)
    expect(suggestions[0]!.food.description).toBe('Chicken breast')
    expect(suggestions[0]!.why).toMatch(/g protein for/)
  })

  it('fills the remaining calories once protein is met', () => {
    const suggestions = suggestFoods({ ...targets(140, 0), proteinMg: -5_000 }, candidates)
    expect(suggestions[0]!.food.description).toBe('White rice')
    expect(suggestions[0]!.why).toMatch(/kcal of the 140/)
  })

  it('never suggests something that busts the budget', () => {
    const suggestions = suggestFoods(targets(200, 40), candidates)
    expect(suggestions.map((s) => s.food.description)).not.toContain('Olive oil')
  })

  it('says nothing when there is barely anything left', () => {
    // "What fits in 40 kcal" is not a useful question, and answering it invites a snack that
    // isn't one.
    expect(suggestFoods(targets(40, 10), candidates)).toEqual([])
  })
})
