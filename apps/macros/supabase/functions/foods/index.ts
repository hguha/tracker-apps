// Proxies USDA FoodData Central so its API key never reaches a client, and caches every hit
// into `foods` (service role, which is the only writer — see 0002_rls.sql) so the second
// lookup is served locally and offline.
//
// Env: USDA_API_KEY (from api.data.gov). Without it the function returns empty results rather
// than failing, so the client's Open Food Facts fallback still works.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const USDA = 'https://api.nal.usda.gov/fdc/v1'

// FDC nutrient numbers, which are stable identifiers; names are not.
const NUTRIENT_IDS: Record<string, string> = {
  '208': 'kcal',
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
  for (const nutrient of food.foodNutrients ?? []) {
    const number = nutrient.nutrientNumber ?? nutrient.nutrient?.number
    const key = number ? NUTRIENT_IDS[number] : undefined
    if (!key) continue
    const value = nutrient.value ?? nutrient.amount
    if (typeof value !== 'number') continue
    // FDC reports macros in g and micros in mg, per 100 g. kcal stays kcal.
    const unit = (nutrient.unitName ?? nutrient.nutrient?.unitName ?? '').toUpperCase()
    per100[key] = key === 'kcal' ? Math.round(value) : Math.round(unit === 'G' ? value * 1000 : value)
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

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405)

  const key = Deno.env.get('USDA_API_KEY')
  const body = (await request.json().catch(() => ({}))) as {
    op?: string
    q?: string
    code?: string
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
      const found = await search(key, body.code, 1)
      const match = found.find((f) => f.gtinUpc === body.code) ?? null
      if (!match) return json({ food: null })
      const row = mapFood(match)
      await admin.from('foods').upsert(row)
      return json({ food: toClient(row) })
    }

    if (body.op === 'search' && body.q) {
      const found = await search(key, body.q, Math.min(50, body.limit ?? 25))
      const rows = found.map(mapFood)
      if (rows.length > 0) await admin.from('foods').upsert(rows)
      return json({ foods: rows.map(toClient) })
    }

    return json({ error: 'Unknown op' }, 400)
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Lookup failed' }, 502)
  }
})

async function search(key: string, query: string, pageSize: number): Promise<FdcFood[]> {
  const response = await fetch(`${USDA}/foods/search?api_key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      pageSize,
      // Whole foods first: someone searching "chicken breast" wants the ingredient.
      dataType: ['Foundation', 'SR Legacy', 'Survey (FNDDS)', 'Branded'],
    }),
  })
  if (!response.ok) throw new Error(`USDA ${response.status}`)
  const body = (await response.json()) as { foods?: FdcFood[] }
  return body.foods ?? []
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
