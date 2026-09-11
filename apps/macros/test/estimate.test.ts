import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import * as repo from '@/data/repository'
import { seedFoods } from '@/db/seed'
import { matchDraft, totalOf, type EstimatedItem, type MealEstimate } from '@/features/log/estimate'
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
  return { items, assumptions: '', nutrients: { ...EMPTY_NUTRIENTS }, label: 'test' }
}

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
