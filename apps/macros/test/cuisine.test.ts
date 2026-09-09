import { describe, expect, it } from 'vitest'
import { cuisineLabel, parseCuisine } from '@/lib/cuisine'

describe('parseCuisine', () => {
  it('reads the labels themselves, case and punctuation aside', () => {
    expect(parseCuisine('Italian')).toBe('italian')
    expect(parseCuisine('  INDIAN ')).toBe('indian')
    expect(parseCuisine('Middle-Eastern')).toBe('middle-eastern')
  })

  it('reads regional names, which is what recipe sites actually publish', () => {
    expect(parseCuisine('Sichuan')).toBe('chinese')
    expect(parseCuisine('Tuscan')).toBe('italian')
    expect(parseCuisine('Lebanese')).toBe('middle-eastern')
    expect(parseCuisine('Punjabi')).toBe('indian')
  })

  it('prefers the longer match, so a compound is not filed by its second half', () => {
    // A substring scan finds "american" in "italian american"; the alias has to win.
    expect(parseCuisine('Italian-American')).toBe('italian')
  })

  it('refuses words too broad to mean one cuisine', () => {
    expect(parseCuisine('Asian')).toBeNull()
    expect(parseCuisine('European')).toBeNull()
    expect(parseCuisine('Fusion')).toBeNull()
  })

  it('returns null rather than guessing, for anything and nothing', () => {
    expect(parseCuisine('Weeknight Dinners')).toBeNull()
    expect(parseCuisine('')).toBeNull()
    expect(parseCuisine(null)).toBeNull()
    expect(parseCuisine(undefined)).toBeNull()
  })

  it('finds a cuisine inside a longer category string', () => {
    expect(parseCuisine('Mexican Recipes')).toBe('mexican')
    expect(parseCuisine('Main Course, Thai')).toBe('thai')
  })
})

describe('cuisineLabel', () => {
  it('names null as unrecorded rather than as a cuisine', () => {
    expect(cuisineLabel(null)).toBe('Uncategorised')
    expect(cuisineLabel('middle-eastern')).toBe('Middle Eastern')
  })
})
