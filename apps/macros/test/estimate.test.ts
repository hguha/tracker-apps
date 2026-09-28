import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import * as repo from '@/data/repository'
import { seedFoods } from '@/db/seed'
import {
  matchDraft,
  readEstimate,
  totalOf,
  type EstimatedItem,
  type MealEstimate,
} from '@/features/log/estimate'
import { gramsToMg, nutrientsFor, per100FromServing } from '@/lib/nutrition'
import { EMPTY_NUTRIENTS } from '@/domain/types'

/**
 * Phase two of a breakdown, on its own.
 *
 * The two phases exist because they were one await behind one spinner: the model request, then up to
 * a dozen food-database round trips, then the whole draft at once. Half a minute of "Working it out…"
 * is indistinguishable from a hang, and the part people care about — *did it understand me?* — was
 * ready in seconds the whole time.
 */
beforeAll(async () => {
  await seedFoods()
})

beforeEach(async () => {
  await Promise.all(db.tables.filter((table) => table.name !== 'foods').map((t) => t.clear()))
  repo.setActiveUserId('local-user')
})

function draft(...queries: string[]): MealEstimate {
  const items: EstimatedItem[] = queries.map((query, index) => ({
    id: `est-${index}`,
    query,
    grams: 100,
    confidence: 'medium',
    food: null,
    matchedBy: 'unmatched',
    isMatching: true,
  }))
  return { items, assumptions: '', nutrients: { ...EMPTY_NUTRIENTS }, label: 'test', product: null }
}

const CHICKEN_BAKE = {
  name: 'Chicken bake',
  brand: 'Costco',
  servingLabel: '1 chicken bake',
  servingGrams: 325,
  kcal: 770,
  proteinG: 57,
  carbsG: 79,
  fatG: 25,
  sodiumMg: 1600,
  confidence: 'high',
  source: "Costco's published nutrition panel",
}

describe('readEstimate', () => {
  it('keeps a named product whole instead of inventing ingredients for it', async () => {
    const read = readEstimate({ kind: 'item', item: CHICKEN_BAKE, assumptions: '' }, 'chicken bake')

    expect(read.items).toEqual([])
    expect(read.product?.name).toBe('Chicken bake')
    expect(read.product?.brand).toBe('Costco')
    expect(read.product?.kcal).toBe(770)
    expect(read.product?.servingGrams).toBe(325)
    expect(read.label).toBe('Chicken bake')
  })

  it('says where the figures came from, and when they are a guess', () => {
    const panel = readEstimate({ kind: 'item', item: CHICKEN_BAKE, assumptions: '' }, '')
    expect(panel.product?.note).toContain("Costco's published nutrition panel")

    const guessed = readEstimate(
      { kind: 'item', item: { ...CHICKEN_BAKE, confidence: 'low' }, assumptions: '' },
      '',
    )
    expect(guessed.product?.note).toMatch(/guess/i)
  })

  it('refuses a product it could not turn into a food', () => {
    for (const broken of [
      { ...CHICKEN_BAKE, servingGrams: 0 },
      { ...CHICKEN_BAKE, kcal: 0 },
      { ...CHICKEN_BAKE, name: '  ' },
    ]) {
      expect(readEstimate({ kind: 'item', item: broken, assumptions: '' }, 'x').product).toBeNull()
    }
  })

  it('ignores an item on a components answer, and components on an item one', () => {
    const components = readEstimate(
      {
        kind: 'components',
        items: [{ query: 'banana', grams: 120, confidence: 'high' }],
        item: CHICKEN_BAKE,
        assumptions: '',
      },
      'a banana',
    )
    expect(components.product).toBeNull()
    expect(components.items).toHaveLength(1)
    expect(components.label).toBe('a banana')
  })

  it('carries the panel through to a food that logs at the stated calories', async () => {
    const { product } = readEstimate(
      { kind: 'item', item: CHICKEN_BAKE, assumptions: '' },
      'chicken bake',
    )
    const id = await repo.saveCustomFood({
      description: product!.name,
      brand: product!.brand,
      barcode: null,
      servingGrams: product!.servingGrams,
      servingLabel: product!.servingLabel,
      per100: {
        ...EMPTY_NUTRIENTS,
        kcal: Math.round(per100FromServing(product!.kcal, product!.servingGrams)),
        proteinMg: gramsToMg(per100FromServing(product!.proteinG, product!.servingGrams)),
        carbsMg: gramsToMg(per100FromServing(product!.carbsG, product!.servingGrams)),
        fatMg: gramsToMg(per100FromServing(product!.fatG, product!.servingGrams)),
      },
    })

    const food = await repo.getFood(id)
    const portion = food!.portions[0]!
    expect(portion.label).toBe('1 chicken bake')
    expect(portion.grams).toBe(325)

    const one = nutrientsFor(food!, portion.grams)
    expect(one.kcal).toBeCloseTo(770, -1)
    expect(one.proteinMg).toBeCloseTo(gramsToMg(57), -2)

    expect(await repo.searchFoods('chicken bake', 10)).toContainEqual(
      expect.objectContaining({ id }),
    )
  })
})

describe('matchDraft', () => {
  it('reports each row as it lands, so the screen can fill in', async () => {
    const seen: string[] = []
    const matched = await matchDraft(draft('banana', 'olive oil'), (item) => seen.push(item.id))
    expect(seen.sort()).toEqual(['est-0', 'est-1'])
    expect(matched.items.every((item) => !item.isMatching)).toBe(true)
  })

  it('recomputes the total from the rows, so the running figure cannot drift', async () => {
    const matched = await matchDraft(draft('banana'))
    expect(matched.nutrients).toEqual(totalOf(matched.items))
    expect(matched.nutrients.kcal).toBeGreaterThan(0)
  })

  it('looks a repeated name up once', async () => {
    // A recipe says "olive oil" twice as often as not, and a described meal repeats ingredients more
    // than you would think — each of which used to be its own round trip.
    const matched = await matchDraft(draft('olive oil', 'olive oil'))
    expect(matched.items[0]!.food?.id).toBe(matched.items[1]!.food?.id)
    expect(matched.items[0]!.food).not.toBeNull()
  })

  it('leaves a row nothing matched as unmatched rather than as still looking', async () => {
    const matched = await matchDraft(draft('zzzqx'))
    expect(matched.items[0]!.isMatching).toBe(false)
    expect(matched.items[0]!.matchedBy).toBe('unmatched')
    // And it contributes nothing, rather than silently rounding the meal down without saying so.
    expect(matched.nutrients.kcal).toBe(0)
  })
})
