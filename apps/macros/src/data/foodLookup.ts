import { syncStamp } from '@tracker-engine/local-first'
import { getSupabase } from '@/backend/supabaseClient'
import { mapOffProduct, mapOffSearch, type OffProduct } from '@/lib/openFoodFacts'
import * as repo from '@/data/repository'
import { normalizeQuery } from '@/lib/foodSearch'
import type { Food } from '@/domain/types'

/**
 * Resolving a barcode, cheapest source first.
 *
 * 1. Local — a scan of something already logged must never need the network.
 * 2. The `foods` edge function, which proxies USDA so its API key stays server-side.
 * 3. Open Food Facts directly. No key and CORS-enabled, so this works with no backend
 *    configured at all — which is what keeps barcode scanning useful in a device-only install.
 *
 * Anything found remotely is cached locally, so the second scan is instant and offline.
 */
export async function lookupBarcode(barcode: string): Promise<Food | null> {
  const code = barcode.trim()
  if (!code) return null

  const local = await repo.findByBarcode(code)
  if (local) return local

  const viaBackend = await fromBackend(code)
  if (viaBackend) return cache(viaBackend)

  const viaOff = await fromOpenFoodFacts(code)
  return viaOff ? cache(viaOff) : null
}

export interface SearchOptions {
  /**
   * Whether to include Open Food Facts. Off for ingredient lookups: breaking down a meal fires one
   * search per ingredient, and OFF holds packaged products — it has nothing useful to say about
   * "cooked spaghetti", while its 503s made a six-ingredient soup feel broken.
   */
  branded?: boolean
  /**
   * How many rows to ask for.
   *
   * Worth setting low for an ingredient lookup, which only ever takes the top hit: the function
   * fetches full details for every result it returns, and measured against the live database,
   * asking for 8 instead of 25 cuts 30–50% off the round trip. The search box keeps the long list,
   * because there a person is reading it.
   */
  limit?: number
}

/**
 * Remote search over both databases, for the long tail the seeded subset doesn't cover.
 *
 * Two sources because they cover different things: USDA has generic and composite foods with full
 * micronutrients ("turkey sandwich on wheat"), Open Food Facts has the packaged products in
 * someone's cupboard by name rather than only by barcode. Both are queried by the `foods` function
 * in one round trip — see its `searchOpenFoodFacts` for why Open Food Facts can no longer be
 * reached from a browser at all — and it drops the Open Food Facts rows whose barcode USDA already
 * answered with a better one.
 */
export async function searchRemote(
  query: string,
  { branded = true, limit = 25 }: SearchOptions = {},
): Promise<Food[]> {
  // Normalised here so USDA sees what the local index sees: "80/20 ground beef" matches nothing
  // upstream, and "80 20 ground beef" matches the right row.
  const q = normalizeQuery(query)
  if (q.length < 2) return []

  const client = getSupabase()
  if (!client) return []
  try {
    const { data, error } = await client.functions.invoke<{
      foods?: Food[]
      products?: OffProduct[]
    }>('foods', { body: { op: 'search', q, limit, generic: !branded } })
    if (error) return []

    const stamp = syncStamp()
    const found = [
      ...(data?.foods ?? []),
      ...mapOffSearch(data?.products ?? []).map((food) => ({ ...food, ...stamp }) as Food),
    ]
    return cacheAll(found)
  } catch {
    return []
  }
}

export interface FoodParts {
  parts: { label: string; grams: number }[]
  text: string | null
}

const partsById = new Map<string, FoodParts | null>()

export async function fetchFoodParts(foodId: string): Promise<FoodParts | null> {
  if (!foodId.startsWith('usda:')) return null
  const cached = partsById.get(foodId)
  if (cached !== undefined) return cached

  const client = getSupabase()
  if (!client) return null
  try {
    const { data, error } = await client.functions.invoke<FoodParts>('foods', {
      body: { op: 'parts', id: foodId },
    })
    const found =
      error || !data || ((data.parts ?? []).length === 0 && !data.text)
        ? null
        : { parts: data.parts ?? [], text: data.text ?? null }
    partsById.set(foodId, found)
    return found
  } catch {
    return null
  }
}

async function cacheAll(foods: Food[]): Promise<Food[]> {
  if (foods.length > 0) await repo.putFoods(foods)
  return foods
}

async function fromBackend(barcode: string): Promise<Omit<Food, keyof SyncCols> | null> {
  const client = getSupabase()
  if (!client) return null
  try {
    const { data, error } = await client.functions.invoke<{ food: Food | null }>('foods', {
      body: { op: 'barcode', code: barcode },
    })
    return error ? null : (data?.food ?? null)
  } catch {
    return null
  }
}

async function fromOpenFoodFacts(barcode: string): Promise<Omit<Food, keyof SyncCols> | null> {
  try {
    const response = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`,
      { headers: { Accept: 'application/json' } },
    )
    if (!response.ok) return null
    const body = (await response.json()) as { status?: number; product?: OffProduct }
    if (body.status !== 1 || !body.product) return null
    return mapOffProduct(body.product)
  } catch {
    return null
  }
}

type SyncCols = { createdAt: number; updatedAt: number; deletedAt: number | null; clientRev: number }

async function cache(food: Omit<Food, keyof SyncCols>): Promise<Food> {
  const row = { ...food, ...syncStamp() } as Food
  await repo.putFoods([row])
  return row
}
