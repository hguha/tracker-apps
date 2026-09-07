import { syncStamp } from '@tracker-engine/local-first'
import { getSupabase } from '@/backend/supabaseClient'
import {
  mapOffProduct,
  mapOffSearch,
  OFF_SEARCH_FIELDS,
  type OffProduct,
} from '@/lib/openFoodFacts'
import * as repo from '@/data/repository'
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

/**
 * Remote search over both sources at once, for the long tail the seeded subset doesn't cover.
 *
 * Two databases because they cover different things and neither is enough: USDA has generic and
 * composite foods with full micronutrients ("turkey sandwich on wheat"), Open Food Facts has the
 * packaged products in someone's cupboard by name rather than only by barcode. Queried in
 * parallel and merged, so a slow or down source costs nothing beyond its own results — and OFF
 * needs no key, which is what keeps search useful with no backend configured at all.
 */
export async function searchRemote(query: string): Promise<Food[]> {
  const q = query.trim()
  if (q.length < 2) return []

  const [usda, off] = await Promise.all([searchBackend(q), searchOpenFoodFacts(q)])
  // USDA first: it carries portions and micronutrients, and lib/foodSearch ranks it above
  // branded rows anyway. Barcodes de-duplicate the overlap between the two.
  const merged = new Map<string, Food>()
  for (const food of [...usda, ...off]) merged.set(food.id, food)

  const foods = [...merged.values()]
  if (foods.length > 0) await repo.putFoods(foods)
  return foods
}

async function searchBackend(query: string): Promise<Food[]> {
  const client = getSupabase()
  if (!client) return []
  try {
    const { data, error } = await client.functions.invoke<{ foods: Food[] }>('foods', {
      body: { op: 'search', q: query, limit: 25 },
    })
    return error ? [] : (data?.foods ?? [])
  } catch {
    // Offline or the function isn't deployed: the other source stands on its own.
    return []
  }
}

/** Text search against Open Food Facts. No key, CORS-enabled, and often the only source that
 *  has a supermarket own-brand product. */
async function searchOpenFoodFacts(query: string): Promise<Food[]> {
  const url =
    `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}` +
    `&search_simple=1&action=process&json=1&page_size=20&fields=${OFF_SEARCH_FIELDS}`
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!response.ok) return []
    const body = (await response.json()) as { products?: OffProduct[] }
    const stamp = syncStamp()
    return mapOffSearch(body.products ?? []).map((food) => ({ ...food, ...stamp }) as Food)
  } catch {
    return []
  }
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
