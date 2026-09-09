import { describe, expect, it } from 'vitest'
import { parseIngredientLine } from '@/lib/parseIngredient'
import { resolveAmount } from '@/lib/resolveAmount'
import { EMPTY_NUTRIENTS, type Food, type FoodPortion } from '@/domain/types'

const food = (portions: [label: string, grams: number][], gramsPerMl: number | null = null): Food => ({
  id: 'usda:1',
  source: 'usda',
  description: 'Test food',
  brand: null,
  barcode: null,
  category: null,
  dataType: 'foundation',
  per100: { ...EMPTY_NUTRIENTS, kcal: 100 },
  gramsPerMl,
  portions: portions.map(([label, grams], index): FoodPortion => ({
    id: `p${index}`,
    label,
    grams,
    isDefault: index === 0,
  })),
  verifiedAt: null,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  clientRev: 1,
})

describe('parseIngredientLine — masses', () => {
  it('reads the amounts a recipe actually writes', () => {
    expect(parseIngredientLine('1/2 pound lean ground beef')).toMatchObject({
      quantity: 0.5,
      unit: 'lb',
      grams: 227,
      name: 'lean ground beef',
    })
    expect(parseIngredientLine('500g beef mince')).toMatchObject({ grams: 500, name: 'beef mince' })
    expect(parseIngredientLine('10 ounces ricotta cheese')).toMatchObject({
      grams: 283,
      name: 'ricotta cheese',
    })
    expect(parseIngredientLine('1.5 kg potatoes')).toMatchObject({ grams: 1500 })
  })

  it('reads vulgar fractions and mixed numbers', () => {
    expect(parseIngredientLine('½ tsp salt').quantity).toBe(0.5)
    expect(parseIngredientLine('1 1/2 cups flour').quantity).toBe(1.5)
    expect(parseIngredientLine('1½ cups flour').quantity).toBe(1.5)
    expect(parseIngredientLine('¼ cup oil').quantity).toBe(0.25)
  })

  it('takes the midpoint of a range rather than dropping the line', () => {
    // "2-3 tbsp" at 2 would be a smaller lie than at nothing, but 2.5 is smaller still.
    expect(parseIngredientLine('2-3 tablespoons olive oil').quantity).toBe(2.5)
  })

  it('prefers a parenthetical mass over the leading count, and multiplies them', () => {
    // "1 (28 oz) can" is 28 oz, not one can of unknown size.
    expect(parseIngredientLine('1 (28 oz) can crushed tomatoes')).toMatchObject({
      grams: 794,
      // "can" is a container, not part of the food — and "crushed tomatoes" is the better search.
      name: 'crushed tomatoes',
    })
    // 30 oz, rounded once at the end rather than per can.
    expect(parseIngredientLine('2 (15 oz) cans black beans').grams).toBe(850)
  })
})

describe('parseIngredientLine — names', () => {
  it('strips preparation notes that wreck the database match', () => {
    // "yellow onion chopped" matches nothing; "yellow onion" matches the onion.
    expect(parseIngredientLine('1 yellow onion, chopped').name).toBe('yellow onion')
    expect(parseIngredientLine('3 cloves garlic, minced').name).toBe('garlic')
    expect(parseIngredientLine('9 lasagna noodles, broken into pieces').name).toBe('lasagna noodles')
    expect(parseIngredientLine('1 cup shredded mozzarella cheese').name).toBe('mozzarella cheese')
  })

  it('keeps a qualifier that is part of the food, not the prep', () => {
    expect(parseIngredientLine('7 cups low sodium chicken broth').name).toBe(
      'low sodium chicken broth',
    )
    expect(parseIngredientLine('1/2 teaspoon Dried oregano').name).toBe('Dried oregano')
  })

  it('handles nested parentheses, which recipe sites use constantly', () => {
    // One pass of /\([^)]*\)/ removes the inner pair and leaves the outer closer, so this logged
    // as "ricotta cheese )" — matching nothing and counting zero.
    expect(parseIngredientLine('10 ounces ricotta cheese ((or cottage cheese))')).toMatchObject({
      name: 'ricotta cheese',
      grams: 283,
    })
    expect(parseIngredientLine('2 cups fresh spinach leaves ((optional),)').name).toBe(
      'fresh spinach leaves',
    )
    expect(parseIngredientLine('salt and pepper (, to taste)').name).toBe('salt and pepper')
  })

  it('reads a bracketed size but ignores a bracketed alternative', () => {
    // "(28 oz)" is how big the can is. "(or 2 tsp dried)" is about a different ingredient, and
    // reading it as the amount measured fresh parsley in teaspoons of dried parsley.
    const parsley = parseIngredientLine('2 Tablespoons fresh parsley (, chopped (or 2 tsp dried))')
    expect(parsley).toMatchObject({ quantity: 2, unit: 'tbsp', name: 'fresh parsley' })
    expect(parseIngredientLine('1 (28 oz) can crushed tomatoes').grams).toBe(794)
  })

  it('records what it removed rather than discarding it silently', () => {
    expect(parseIngredientLine('1 onion, finely chopped').note).toContain('finely chopped')
  })
})

describe('parseIngredientLine — no usable amount', () => {
  it('flags a seasoning instead of inventing a weight for it', () => {
    const salt = parseIngredientLine('salt and freshly ground black pepper, to taste')
    expect(salt.isToTaste).toBe(true)
    expect(salt.grams).toBeNull()

    const basil = parseIngredientLine('fresh basil, for serving')
    expect(basil.isToTaste).toBe(true)
    expect(basil.quantity).toBeNull()
  })

  it('reads a bare count as pieces', () => {
    expect(parseIngredientLine('2 eggs')).toMatchObject({ quantity: 2, unit: 'piece', grams: null })
  })
})

describe('resolveAmount', () => {
  it('uses a mass directly, with no food knowledge at all', () => {
    expect(resolveAmount(parseIngredientLine('8 oz cream cheese'), null)).toEqual({
      grams: 227,
      basis: 'mass',
    })
  })

  it("prefers the food's own cup weight over any density table", () => {
    // A cup of flour is 120 g and a cup of oil is 218 g. Only the food knows.
    const flour = resolveAmount(parseIngredientLine('2 cups flour'), food([['1 cup', 120]]))
    expect(flour).toEqual({ grams: 240, basis: 'portion' })
  })

  it('matches a portion label loosely, because USDA writes them loosely', () => {
    const onion = resolveAmount(
      parseIngredientLine('1 cup chopped onion'),
      food([['1 cup, chopped', 160]]),
    )
    expect(onion).toEqual({ grams: 160, basis: 'portion' })
  })

  it('falls back to a stated density for a volume', () => {
    const milk = resolveAmount(parseIngredientLine('1 cup milk'), food([], 1.03))
    expect(milk.basis).toBe('density')
    expect(milk.grams).toBe(244)
  })

  it("counts a bare piece against the food's default portion", () => {
    const eggs = resolveAmount(parseIngredientLine('3 eggs'), food([['1 large', 50]]))
    expect(eggs).toEqual({ grams: 150, basis: 'portion' })
  })

  it('assumes water for a volume with nothing better, and says so', () => {
    const broth = resolveAmount(parseIngredientLine('7 cups chicken broth'), food([]))
    expect(broth.basis).toBe('assumed-water')
    expect(broth.grams).toBe(1656)
  })

  it('refuses to invent a weight for a countable thing it cannot count', () => {
    // Three sprigs of thyme against a row with no per-sprig weight: a visible gap beats a guess.
    expect(resolveAmount(parseIngredientLine('3 sprigs thyme'), food([]))).toEqual({
      grams: null,
      basis: 'unresolved',
    })
    expect(resolveAmount(parseIngredientLine('salt to taste'), food([['1 tsp', 6]]))).toEqual({
      grams: null,
      basis: 'unresolved',
    })
  })
})

describe('the lasagna soup import, end to end', () => {
  // The real nineteen lines from tastesbetterfromscratch.com, which is the case that failed.
  const LINES = [
    '1/2 pound lean ground beef',
    '1/2 pound ground Italian sausage',
    'salt and freshly ground black pepper (, to taste)',
    '1 yellow onion (, chopped)',
    '1 Tablespoon olive oil',
    '3 cloves garlic (, minced)',
    '2 Tablespoons tomato paste',
    '1 recipe homemade marinara sauce ((or 24 ounce marinara sauce))',
    '1/4 teaspoon red pepper flakes',
    '2 Tablespoons fresh parsley (, chopped (or 2 tsp dried))',
    '1/2 teaspoon Dried oregano',
    '1 teaspoons dried basil',
    '7 cups low sodium chicken broth ((or vegetable broth))',
    '9 lasagna noodles (, broken into pieces)',
    '2 cups fresh spinach leaves ((optional),)',
    '10 ounces ricotta cheese ((or cottage cheese))',
    '1 cup shredded mozzarella cheese',
    '1/2 cup freshly grated parmesan cheese',
    'fresh basil (, for serving)',
  ]

  it('gets an amount or an honest skip for every line, with no model at all', () => {
    const parsed = LINES.map(parseIngredientLine)
    const withAmount = parsed.filter((row) => row.quantity !== null)
    const skipped = parsed.filter((row) => row.quantity === null)

    // Only the two garnish lines have no amount to read, and both are flagged.
    expect(skipped).toHaveLength(2)
    expect(skipped.every((row) => row.isToTaste)).toBe(true)
    expect(withAmount).toHaveLength(17)

    // The two masses are exact.
    expect(parsed[0]!.grams).toBe(227)
    expect(parsed[15]!.grams).toBe(283)
    // And the names are searchable, which is the point of stripping the prep.
    expect(parsed[3]!.name).toBe('yellow onion')
    expect(parsed[5]!.name).toBe('garlic')
  })
})
