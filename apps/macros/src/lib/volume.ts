import { ML_PER, parseIngredientLine, type AmountUnit } from '@/lib/parseIngredient'
import type { Food, FoodPortion } from '@/domain/types'

type VolumeBasis = 'portion' | 'density' | 'borrowed' | 'liquid'

interface VolumeDensity {
  gramsPerMl: number
  basis: VolumeBasis
  hasSmallMeasure: boolean
}

const VOLUME_UNITS: AmountUnit[] = ['cup', 'tbsp', 'tsp', 'fl-oz', 'ml', 'l', 'pint', 'quart']

const LIQUID =
  /\b(milk|juice|water|soda|cola|coffee|latte|tea|beer|wine|broth|stock|kombucha|smoothie|lemonade|drink|beverage|shake|kefir|creamer)\b/i

function densityFromPortions(portions: readonly FoodPortion[]): number | null {
  for (const portion of portions) {
    if (!(portion.grams > 0)) continue
    const parsed = parseIngredientLine(portion.label)
    if (parsed.quantity === null || parsed.quantity <= 0 || parsed.unit === null) continue
    if (!VOLUME_UNITS.includes(parsed.unit)) continue
    const ml = ML_PER[parsed.unit]
    if (!ml) continue
    return portion.grams / (parsed.quantity * ml)
  }
  return null
}

const mentionsSmallMeasure = (portions: readonly FoodPortion[]): boolean =>
  portions.some((portion) => /\b(tbsp|tablespoons?|tsp|teaspoons?)\b/i.test(portion.label))

export function volumeDensity(
  food: Food,
  borrowed: readonly FoodPortion[] = [],
): VolumeDensity | null {
  const own = densityFromPortions(food.portions)
  if (own !== null) {
    return { gramsPerMl: own, basis: 'portion', hasSmallMeasure: mentionsSmallMeasure(food.portions) }
  }
  if (food.gramsPerMl !== null && food.gramsPerMl > 0) {
    return { gramsPerMl: food.gramsPerMl, basis: 'density', hasSmallMeasure: false }
  }
  const lent = densityFromPortions(borrowed)
  if (lent !== null) {
    return { gramsPerMl: lent, basis: 'borrowed', hasSmallMeasure: mentionsSmallMeasure(borrowed) }
  }
  if (LIQUID.test(food.description)) {
    return { gramsPerMl: 1, basis: 'liquid', hasSmallMeasure: false }
  }
  return null
}

interface VolumeMeasure {
  id: string
  label: string
  grams: number
}

export function volumeMeasures(
  food: Food,
  borrowed: readonly FoodPortion[] = [],
): VolumeMeasure[] {
  const density = volumeDensity(food, borrowed)
  if (!density) return []
  const prefix = density.basis === 'portion' || density.basis === 'density' ? '' : '≈ '
  const make = (unit: 'cup' | 'tbsp' | 'tsp') => {
    const grams = Math.round(ML_PER[unit]! * density.gramsPerMl * 10) / 10
    return { id: `__${unit}`, label: `${prefix}${unit} · ${Math.round(grams)} g`, grams }
  }
  const spoonable =
    density.hasSmallMeasure || density.basis === 'density' || density.basis === 'liquid'
  return [
    make('cup'),
    ...(spoonable ? [make('tbsp')] : []),
    ...(density.hasSmallMeasure ? [make('tsp')] : []),
  ].filter((measure) => measure.grams > 0)
}
