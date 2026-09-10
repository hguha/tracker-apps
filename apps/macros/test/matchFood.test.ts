import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import * as repo from '@/data/repository'
import { matchIngredient } from '@/data/matchFood'
import { seedFoods } from '@/db/seed'
import { normalizeQuery, queryTerms, searchVariants } from '@/lib/foodSearch'

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

describe('searchVariants', () => {
  it('offers the name as written first', () => {
    expect(searchVariants('cooked spaghetti')[0]).toBe('cooked spaghetti')
  })

  it('translates a recipe name into USDA vocabulary', () => {
    // The whole reason aliases exist: USDA has no "lasagna noodles" at all.
    expect(searchVariants('lasagna noodles, dry')).toContain('pasta dry enriched')
  })

  it('relaxes from the front, because the head noun is last', () => {
    const variants = searchVariants('lasagna noodles dry')
    expect(variants).toContain('lasagna noodles')
    expect(variants).toContain('noodles dry')
    expect(variants).toContain('noodles')
    // "dry" on its own is four letters of nothing; it must not become a query.
    expect(variants).not.toContain('dry')
  })

  it('never invents a word that wasn’t asked for, aliases aside', () => {
    const asked = new Set(['low', 'sodium', 'chicken', 'broth'])
    const aliased = searchVariants('low sodium chicken broth')
    for (const variant of aliased) {
      if (variant === 'soup chicken broth canned') continue
      for (const word of variant.split(' ')) expect(asked.has(word)).toBe(true)
    }
  })

  it('declines a name too short to mean anything', () => {
    expect(searchVariants('')).toEqual([])
    expect(searchVariants('a')).toEqual([])
  })
})

describe('matchIngredient', () => {
  it('finds a food whose name the user wrote differently', async () => {
    // "lasagna noodles, dry" against the seed. Every term must appear was the old rule, and no row
    // contains all three — so the line came back unmatched and contributed zero calories to a meal.
    const matched = await matchIngredient('lasagna noodles, dry')
    expect(matched.food).not.toBeNull()
    expect(matched.matchedBy).toBe('fuzzy')
    expect(matched.food!.description.toLowerCase()).toMatch(/pasta|noodle/)
  })

  it('calls an as-written hit exact, so the UI can tell them apart', async () => {
    const matched = await matchIngredient('Chicken breast, skinless, raw')
    expect(matched.matchedBy).toBe('exact')
  })

  it('says so rather than guessing when there is genuinely nothing', async () => {
    const matched = await matchIngredient('zzzqx')
    expect(matched).toEqual({ food: null, matchedBy: 'unmatched', usedQuery: null })
  })
})
