// Reads a recipe off a web page, server-side.
//
// Server-side because the browser can't: recipe sites don't send CORS headers, so a client fetch
// is blocked outright. Almost every recipe site emits schema.org `Recipe` as JSON-LD (WordPress
// Recipe Maker, Tasty, Squarespace and friends all do), which is a far better source than scraping
// markup — it's the same data the site hands Google, so it's the one thing on the page they keep
// correct.
//
// Returns ingredient *lines* verbatim. Turning "1/2 pound lean ground beef" into a food and a
// weight happens in the coach function, and matching happens on the client, so the numbers still
// come from the food database rather than from a web page.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** A page big enough to hold a recipe and small enough not to be a denial-of-service vector. */
const MAX_BYTES = 3_000_000
const TIMEOUT_MS = 8_000

interface RecipeNode {
  '@type'?: string | string[]
  name?: unknown
  recipeYield?: unknown
  recipeIngredient?: unknown
  recipeInstructions?: unknown
  recipeCuisine?: unknown
  recipeCategory?: unknown
  keywords?: unknown
  totalTime?: unknown
  cookTime?: unknown
  prepTime?: unknown
  image?: unknown
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (request.method !== 'POST') return json({ error: 'POST only' })

  const { url } = (await request.json().catch(() => ({}))) as { url?: string }
  const target = safeUrl(url ?? '')
  if (!target) return json({ error: 'That does not look like a recipe link.' })

  let html: string
  try {
    const response = await fetch(target, {
      // Some sites serve a stub to unknown agents; this is the same string a browser sends.
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        Accept: 'text/html',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) {
      return json({ error: `That page returned ${response.status} and wouldn't open.` })
    }
    html = (await response.text()).slice(0, MAX_BYTES)
  } catch {
    return json({ error: "Couldn't open that page — check the link, or paste the ingredients in." })
  }

  const recipe = findRecipe(html)
  if (!recipe) {
    return json({
      error:
        "That page doesn't publish its recipe in a readable form. Copy the ingredient list and paste it in instead.",
    })
  }

  return json({
    name: text(recipe.name) ?? 'Imported recipe',
    servings: servingsOf(recipe.recipeYield),
    ingredients: lines(recipe.recipeIngredient),
    steps: instructions(recipe.recipeInstructions),
    // Free text — the client maps it onto its own closed list, or files it as a tag.
    cuisine: text(first(recipe.recipeCuisine)),
    category: text(first(recipe.recipeCategory)),
    totalMinutes: minutesOf(recipe.totalTime) ?? sumMinutes(recipe.prepTime, recipe.cookTime),
    sourceUrl: target.toString(),
  })
})

/**
 * Only public http(s) hosts.
 *
 * This function holds a service-role-capable network position, so without these checks it would be
 * a request forwarder anyone with a session could point at internal addresses.
 */
function safeUrl(raw: string): URL | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  const host = url.hostname.toLowerCase()
  const isPrivate =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    host.startsWith('[')
  return isPrivate ? null : url
}

function findRecipe(html: string): RecipeNode | null {
  const blocks = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )
  for (const block of blocks) {
    let parsed: unknown
    try {
      parsed = JSON.parse(block[1] ?? '')
    } catch {
      continue
    }
    const found = search(parsed)
    if (found) return found
  }
  return null
}

/** JSON-LD arrives as a node, an array, or an `@graph` — and nested either way. */
function search(value: unknown, depth = 0): RecipeNode | null {
  if (depth > 6 || value === null || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = search(item, depth + 1)
      if (found) return found
    }
    return null
  }

  const node = value as RecipeNode & { '@graph'?: unknown }
  const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']]
  if (types.includes('Recipe') && node.recipeIngredient) return node
  return search(node['@graph'], depth + 1)
}

const first = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value)

/**
 * ISO 8601 durations, which is what schema.org uses: `PT1H15M`.
 *
 * Days are deliberately ignored. A `P1D` on a recipe means an overnight prove or a marinade, and
 * reporting "1445 minutes" next to a weeknight dinner is worse than saying nothing.
 */
function minutesOf(value: unknown): number | null {
  const match = String(first(value) ?? '').match(/^PT(?:(\d+)H)?(?:(\d+)M)?/)
  if (!match || (!match[1] && !match[2])) return null
  const minutes = Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)
  return minutes > 0 && minutes < 24 * 60 ? minutes : null
}

/** Prep plus cook, for the many sites that publish those but not a total. */
function sumMinutes(prep: unknown, cook: unknown): number | null {
  const total = (minutesOf(prep) ?? 0) + (minutesOf(cook) ?? 0)
  return total > 0 ? total : null
}

function servingsOf(value: unknown): number | null {
  const digits = String(first(value) ?? '').match(/\d+/)
  const parsed = digits ? Number(digits[0]) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 && parsed < 100 ? parsed : null
}

function lines(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => text(item) ?? '')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 40)
}

function instructions(value: unknown): string[] {
  if (!Array.isArray(value)) return typeof value === 'string' ? [stripTags(value)] : []
  return value
    .map((step) => {
      if (typeof step === 'string') return stripTags(step)
      const node = step as { text?: unknown; name?: unknown; itemListElement?: unknown }
      if (Array.isArray(node.itemListElement)) return instructions(node.itemListElement).join(' ')
      return stripTags(text(node.text) ?? text(node.name) ?? '')
    })
    .filter(Boolean)
    .slice(0, 30)
}

const stripTags = (value: string): string =>
  value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = stripTags(value)
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Always HTTP 200, even for a failure.
 *
 * supabase-js discards the body of a non-2xx response, so every carefully worded reason above
 * would reach the user as a generic "Edge Function returned a non-2xx status code" and the app
 * would have to invent its own explanation — which is how "that page has no recipe" became
 * indistinguishable from "you're offline". The `error` field carries the status instead.
 */
function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
