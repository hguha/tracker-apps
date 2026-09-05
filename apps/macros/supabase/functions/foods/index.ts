// Proxies USDA FoodData Central so its API key never reaches a client, and caches every hit
// into `foods` (service role, which is the only writer — see 0002_rls.sql) so the second
// lookup is served locally and offline.
//
// Env: USDA_API_KEY (from api.data.gov). Without it the function returns empty results rather
// than failing, so the client's Open Food Facts fallback still works.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const USDA = 'https://api.nal.usda.gov/fdc/v1'

// FDC nutrient numbers, which are stable identifiers; names are not.
//
// Energy needs three of them. SR Legacy and Branded report 208; many Foundation foods report
// only the Atwater variants (957 general, 958 specific) and would otherwise come back as 0
// kcal — which is how the first version returned zero-calorie chicken breast.
const ENERGY_NUMBERS = ['208', '958', '957']

const NUTRIENT_IDS: Record<string, string> = {
  '208': 'kcal',
  '957': 'kcal',
  '958': 'kcal',
  '203': 'proteinMg',
  '205': 'carbsMg',
  '204': 'fatMg',
  '291': 'fiberMg',
  '269': 'sugarMg',
  '606': 'satFatMg',
  '307': 'sodiumMg',
  '306': 'potassiumMg',
  '601': 'cholesterolMg',
  '301': 'calciumMg',
  '303': 'ironMg',
}

const EMPTY = {
  kcal: 0, proteinMg: 0, carbsMg: 0, fatMg: 0,
  fiberMg: null, sugarMg: null, satFatMg: null, sodiumMg: null,
  potassiumMg: null, cholesterolMg: null, calciumMg: null, ironMg: null,
} as Record<string, number | null>

interface FdcNutrient {
  nutrientNumber?: string
  nutrient?: { number?: string; unitName?: string }
  unitName?: string
  value?: number
  amount?: number
}

interface FdcFood {
  fdcId: number
  description?: string
  brandOwner?: string
  brandName?: string
  gtinUpc?: string
  foodCategory?: string | { description?: string }
  dataType?: string
  foodNutrients?: FdcNutrient[]
  foodPortions?: { id?: number; gramWeight?: number; modifier?: string; amount?: number }[]
  servingSize?: number
  servingSizeUnit?: string
}

function mapFood(food: FdcFood) {
  const per100 = { ...EMPTY }
  // Energy: prefer 208, then Atwater specific, then general — whichever is present.
  const byNumber = new Map<string, number>()
  for (const nutrient of food.foodNutrients ?? []) {
    const number = nutrient.nutrientNumber ?? nutrient.nutrient?.number
    const value = nutrient.value ?? nutrient.amount
    if (!number || typeof value !== 'number') continue
    if (!byNumber.has(number)) byNumber.set(number, value)

    const key = NUTRIENT_IDS[number]
    if (!key || key === 'kcal') continue
    // FDC reports macros in g and micros in mg, per 100 g.
    const unit = (nutrient.unitName ?? nutrient.nutrient?.unitName ?? '').toUpperCase()
    per100[key] = Math.round(unit === 'G' ? value * 1000 : value)
  }
  for (const number of ENERGY_NUMBERS) {
    const value = byNumber.get(number)
    if (typeof value === 'number') {
      per100.kcal = Math.round(value)
      break
    }
  }

  const portions = (food.foodPortions ?? [])
    .filter((p) => typeof p.gramWeight === 'number' && p.gramWeight > 0)
    .map((p, index) => ({
      id: `usda-${p.id ?? index}`,
      label: [p.amount, p.modifier].filter(Boolean).join(' ') || '1 portion',
      grams: p.gramWeight as number,
      isDefault: index === 0,
    }))

  if (portions.length === 0 && typeof food.servingSize === 'number' &&
      (food.servingSizeUnit ?? '').toLowerCase() === 'g') {
    portions.push({ id: 'usda-serving', label: '1 serving', grams: food.servingSize, isDefault: true })
  }

  const category =
    typeof food.foodCategory === 'string' ? food.foodCategory : food.foodCategory?.description

  return {
    id: `usda:${food.fdcId}`,
    source: 'usda',
    description: food.description ?? '',
    brand: food.brandName ?? food.brandOwner ?? null,
    barcode: food.gtinUpc ?? null,
    category: category ?? null,
    data_type: food.dataType ?? null,
    per100,
    grams_per_ml: null,
    portions,
    verified_at: new Date().toISOString(),
  }
}

function toClient(row: ReturnType<typeof mapFood>) {
  const { data_type, grams_per_ml, verified_at, ...rest } = row
  return {
    ...rest,
    dataType: data_type,
    gramsPerMl: grams_per_ml,
    verifiedAt: Date.parse(verified_at),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deletedAt: null,
    clientRev: 1,
  }
}

// A browser preflights every cross-origin POST, so without these the function is unreachable
// from the app entirely — which unit tests and an empty-env E2E run can never surface.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405)

  const key = Deno.env.get('USDA_API_KEY')
  const body = (await request.json().catch(() => ({}))) as {
    op?: string
    q?: string
    code?: string
    id?: string
    limit?: number
  }

  // No key configured: say so with empty results, so the client falls back rather than errors.
  if (!key) return json(body.op === 'barcode' ? { food: null } : { foods: [] })

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  try {
    if (body.op === 'barcode' && body.code) {
      // Branded only, and more than one hit: FDC's search matches a barcode loosely, so the
      // exact gtinUpc has to be picked out of several results rather than assumed to be first.
      const found = await search(key, body.code, 10, ['Branded'])
      const match = found.find((f) => f.gtinUpc === body.code)
      if (!match) return json({ food: null })
      const [row] = await withPortions(key, [match])
      if (!row) return json({ food: null })
      await admin.from('foods').upsert(row)
      return json({ food: toClient(row) })
    }

    if (body.op === 'search' && body.q) {
      const found = await search(key, body.q, Math.min(50, body.limit ?? 25))
      const rows = await withPortions(key, found)
      if (rows.length > 0) await admin.from('foods').upsert(rows)
      return json({ foods: rows.map(toClient) })
    }

    if (body.op === 'get' && body.id) {
      const fdcId = body.id.replace(/^usda:/, '')
      const [detail] = await details(key, [fdcId])
      if (!detail) return json({ food: null })
      const row = mapFood(detail)
      await admin.from('foods').upsert(row)
      return json({ food: toClient(row) })
    }

    return json({ error: 'Unknown op' }, 400)
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Lookup failed' }, 502)
  }
})

/**
 * Search returns no `foodPortions`, so a hit would have no "1 breast" or "1 slice" to log by —
 * only raw grams. The detail endpoint has them, and one bulk call covers the whole page, so
 * every search costs two requests instead of N.
 */
async function withPortions(key: string, foods: FdcFood[]) {
  if (foods.length === 0) return []
  try {
    const detailed = await details(key, foods.map((f) => String(f.fdcId)))
    const byId = new Map(detailed.map((f) => [f.fdcId, f]))
    return foods.map((f) => mapFood(byId.get(f.fdcId) ?? f))
  } catch {
    // A detail lookup failing must not lose the search: grams-only is still usable.
    return foods.map(mapFood)
  }
}

async function details(key: string, fdcIds: string[]): Promise<FdcFood[]> {
  const response = await fetch(`${USDA}/foods?api_key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fdcIds, format: 'full' }),
  })
  if (!response.ok) throw new Error(`USDA details ${response.status}`)
  return (await response.json()) as FdcFood[]
}

async function search(
  key: string,
  query: string,
  pageSize: number,
  dataType = ['Foundation', 'SR Legacy', 'Survey (FNDDS)', 'Branded'],
): Promise<FdcFood[]> {
  const response = await fetch(`${USDA}/foods/search?api_key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Whole foods first: someone searching "chicken breast" wants the ingredient.
    body: JSON.stringify({ query, pageSize, dataType }),
  })
  if (!response.ok) throw new Error(`USDA ${response.status}`)
  const body = (await response.json()) as { foods?: FdcFood[] }
  return body.foods ?? []
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
