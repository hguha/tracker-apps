import { EMPTY_NUTRIENTS, type Food, type FoodPortion, type Nutrients } from '@/domain/types'
import { gramsToMg } from '@/lib/nutrition'

/**
 * Maps an Open Food Facts product to a Food.
 *
 * OFF is crowd-sourced, so fields are routinely missing, blank, or the wrong unit. Every
 * value here is therefore treated as untrusted: absent means `null` (unknown), never 0, so a
 * product with no fibre figure doesn't silently claim zero fibre. Returns null when the four
 * macros aren't all present, because a food row without them can't be logged honestly.
 */

export interface OffProduct {
  code?: string
  product_name?: string
  brands?: string
  categories?: string
  serving_quantity?: number | string
  serving_size?: string
  nutriments?: Record<string, unknown>
}

export function mapOffProduct(product: OffProduct): Omit<Food, keyof SyncCols> | null {
  const n = product.nutriments ?? {}
  const kcal = num(n['energy-kcal_100g'])
  const protein = num(n['proteins_100g'])
  const carbs = num(n['carbohydrates_100g'])
  const fat = num(n['fat_100g'])
  if (kcal === null || protein === null || carbs === null || fat === null) return null

  const name = text(product.product_name)
  const barcode = text(product.code)
  if (!name || !barcode) return null

  const per100: Nutrients = {
    ...EMPTY_NUTRIENTS,
    kcal: Math.round(kcal),
    proteinMg: gramsToMg(protein),
    carbsMg: gramsToMg(carbs),
    fatMg: gramsToMg(fat),
    fiberMg: optionalG(n['fiber_100g']),
    sugarMg: optionalG(n['sugars_100g']),
    satFatMg: optionalG(n['saturated-fat_100g']),
    // OFF reports sodium in grams per 100 g, not milligrams — a direct copy would be 1000x out.
    sodiumMg: optionalG(n['sodium_100g']),
    potassiumMg: optionalG(n['potassium_100g']),
    cholesterolMg: optionalG(n['cholesterol_100g']),
    calciumMg: optionalG(n['calcium_100g']),
    ironMg: optionalG(n['iron_100g']),
  }

  return {
    id: `off:${barcode}`,
    source: 'off',
    description: name,
    brand: text(product.brands)?.split(',')[0]?.trim() ?? null,
    barcode,
    category: text(product.categories)?.split(',')[0]?.trim() ?? null,
    dataType: 'off',
    per100,
    gramsPerMl: null,
    portions: servingPortion(product),
    // Never marked verified: OFF data is user-submitted and the UI should say so.
    verifiedAt: null,
  }
}

type SyncCols = { createdAt: number; updatedAt: number; deletedAt: number | null; clientRev: number }

/**
 * The fields a text search needs. Requested explicitly because the default response carries
 * hundreds of fields per product — megabytes for one query on a phone.
 */
export const OFF_SEARCH_FIELDS = [
  'code',
  'product_name',
  'brands',
  'categories',
  'serving_quantity',
  'serving_size',
  'nutriments',
].join(',')

/** Maps a search response, dropping every product too incomplete to log honestly. */
export function mapOffSearch(products: readonly OffProduct[]): Omit<Food, keyof SyncCols>[] {
  const mapped: Omit<Food, keyof SyncCols>[] = []
  for (const product of products) {
    const food = mapOffProduct(product)
    if (food) mapped.push(food)
  }
  return mapped
}

/** A "1 serving" portion when OFF states a serving mass, since that's how packages are eaten. */
function servingPortion(product: OffProduct): FoodPortion[] {
  const grams = num(product.serving_quantity)
  if (grams === null || grams <= 0) return []
  return [
    {
      id: 'off-serving',
      label: text(product.serving_size) ?? '1 serving',
      grams,
      isDefault: true,
    },
  ]
}

function optionalG(value: unknown): number | null {
  const g = num(value)
  return g === null ? null : gramsToMg(g)
}

/** OFF returns numbers as numbers or strings, and empty strings for "not stated". */
function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}
