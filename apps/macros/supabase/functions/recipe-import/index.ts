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
  image?: unknown
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405)

  const { url } = (await request.json().catch(() => ({}))) as { url?: string }
  const target = safeUrl(url ?? '')
  if (!target) return json({ error: 'That does not look like a recipe link.' }, 400)

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
    if (!response.ok) return json({ error: `The page returned ${response.status}.` }, 502)
    html = (await response.text()).slice(0, MAX_BYTES)
  } catch {
    return json({ error: "Couldn't open that page." }, 502)
  }

  const recipe = findRecipe(html)
  if (!recipe) {
    return json(
      {
        error:
          "That page doesn't publish its recipe in a readable format. Paste the ingredients into the box instead.",
      },
      422,
    )
  }

  return json({
    name: text(recipe.name) ?? 'Imported recipe',
    servings: servingsOf(recipe.recipeYield),
    ingredients: lines(recipe.recipeIngredient),
    steps: instructions(recipe.recipeInstructions),
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

function servingsOf(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value
  const digits = String(raw ?? '').match(/\d+/)
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
