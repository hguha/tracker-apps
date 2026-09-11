import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import * as repo from '@/data/repository'
import { matchIngredient } from '@/data/matchFood'
import { seedFoods } from '@/db/seed'
import { normalizeQuery, overlapScore, queryTerms } from '@/lib/foodSearch'

beforeAll(async () => {
  await seedFoods()
})

beforeEach(async () => {
  await Promise.all(db.tables.filter((table) => table.name !== 'foods').map((t) => t.clear()))
  repo.setActiveUserId('local-user')
})

describe('normalizeQuery', () => {
  it('drops punctuation, so a term never carries a comma', () => {
    // The bug: `queryTerms('noodles, dry')` produced the term "noodles," and every match then
    // required the database to put its comma in exactly the same place.
    expect(queryTerms('lasagna noodles, dry')).toEqual(['lasagna', 'noodles', 'dry'])
    expect(normalizeQuery('Chicken (breast), raw.')).toBe('chicken breast raw')
  })

  it('still keeps the lean/fat ratio numbers it was written for', () => {
    expect(normalizeQuery('80/20 ground beef')).toBe('80 20 ground beef')
    expect(normalizeQuery('2% milk')).toBe('2 milk')
  })
})

describe('overlapScore', () => {
  it('weighs the head noun above a modifier, with no table to maintain', () => {
    // This is what replaced 55 hand-written ingredient aliases. "lasagna noodles, dry" must land on
    // a noodle rather than on "Lasagna with meat", and nobody should have to write that rule down.
    const terms = queryTerms('lasagna noodles dry')
    expect(overlapScore('noodles, egg, dry, enriched', terms)).toBeGreaterThan(
      overlapScore('lasagna with meat', terms),
    )
  })

  it('scores a row sharing nothing at zero, so it can be excluded rather than ranked', () => {
    expect(overlapScore('beef, ground, raw', queryTerms('tangerine'))).toBe(0)
  })
})

describe('dialect', () => {
  it('translates the words a US database has never seen', () => {
    // Spelling, not synonymy: FoodData Central returns literally nothing for "courgette", and no
    // relevance ranking can bridge a word the index does not contain.
    expect(normalizeQuery('2 courgettes, sliced')).toBe('2 zucchini sliced')
    expect(normalizeQuery('500g beef mince')).toBe('500g beef ground')
  })

  it('leaves alone what USDA resolves on its own', () => {
    // Checked against the live database: "heavy whipping cream", "scallions" and "Italian sausage"
    // all return the right row first, so listing them would be maintenance for nothing.
    expect(normalizeQuery('heavy whipping cream')).toBe('heavy whipping cream')
    expect(normalizeQuery('italian sausage')).toBe('italian sausage')
  })
})

describe('matchIngredient', () => {
  it('finds a food whose name the user wrote differently', async () => {
    // "lasagna noodles, dry" against the seed, with no network. Every term must appear was the old
    // rule, and no row contains all three — so the line came back unmatched and contributed zero
    // calories to a meal, which looks exactly like the food being free.
    const matched = await matchIngredient('lasagna noodles, dry')
    expect(matched.food).not.toBeNull()
    expect(matched.matchedBy).toBe('fuzzy')
    expect(matched.food!.description.toLowerCase()).toMatch(/pasta|noodle/)
  })

  it('translates a dialect word before searching', async () => {
    const matched = await matchIngredient('courgette')
    expect(matched.food?.description.toLowerCase()).toContain('zucchini')
  })

  it('calls an as-written hit exact, so the UI can tell them apart', async () => {
    const matched = await matchIngredient('Chicken breast, skinless, raw')
    expect(matched.matchedBy).toBe('exact')
  })

  it('says so rather than guessing when there is genuinely nothing', async () => {
    const matched = await matchIngredient('zzzqx')
    expect(matched).toEqual({ food: null, matchedBy: 'unmatched' })
  })
})
