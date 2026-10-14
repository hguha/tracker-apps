import { describe, expect, it } from 'vitest'
import { parseIngredientLine } from '@/lib/parseIngredient'
import { replaceWeighed, rowFromFood, type Row } from '@/features/recipes/rows'

const unweighed = (line: string): Row => {
  const parsed = parseIngredientLine(line)
  return { ...rowFromFood(null, parsed.name, 0), parsed, needsWeight: true }
}

describe('replaceWeighed', () => {
  it('replaces only the lines the AI was asked to weigh', () => {
    const earlier = unweighed('a handful of spinach')
    const asked = unweighed('some basil')
    const weighed = rowFromFood(null, 'basil', 5)

    const next = replaceWeighed([earlier, asked], [asked.parsed!], [weighed])

    expect(next).toEqual([earlier, weighed])
  })

  it('keeps a row that has since been weighed by hand', () => {
    const picked = { ...unweighed('some basil'), needsWeight: false, grams: 8 }

    expect(replaceWeighed([picked], [picked.parsed!], [])).toEqual([picked])
  })
})
