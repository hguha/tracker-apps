import { syncStamp } from '@tracker-engine/local-first'
import { getSupabase } from '@/backend/supabaseClient'
import { mapOffProduct, type OffProduct } from '@/lib/openFoodFacts'
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

/** Remote search, for the long tail the seeded subset doesn't cover. Empty without a backend. */
export async function searchRemote(query: string): Promise<Food[]> {
  const client = getSupabase()
  if (!client || query.trim().length < 2) return []
  try {
    const { data, error } = await client.functions.invoke<{ foods: Food[] }>('foods', {
      body: { op: 'search', q: query.trim(), limit: 25 },
    })
    if (error || !data?.foods) return []
    await repo.putFoods(data.foods)
    return data.foods
  } catch {
    // Offline or the function isn't deployed: local results stand on their own.
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
