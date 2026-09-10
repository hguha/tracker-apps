// Fills the missing micronutrients on src/db/seed/staples.ts from USDA, in place.
//
// The 46 staples were hand-written before the generator existed and carry only kcal, the three macros
// and fibre. That would be a minor gap except that they are *short, clean* descriptions — "Chicken
// breast, skinless, raw" — so `rankFoods` puts them above the fuller USDA rows for exactly the queries
// people type most. The result: the app's most-logged foods were the ones with no micronutrient data,
// and a day built from them reported six of seven nutrients as unrecorded.
//
// Values come from the deployed `foods` function, the same source as the generated seed, so there is
// one implementation of the USDA mapping rather than two.
//
// **Only null fields are filled, and only when the macros agree.** A staple's own kcal and protein are
// hand-checked and stay authoritative; a candidate whose energy or protein is materially different is a
// different food, and copying its sodium would be inventing a number. Descriptions and ids are never
// touched — the demo data refers to these rows by exact description.
//
// Usage: node scripts/fill-staple-micros.mjs   (needs .env with VITE_SUPABASE_URL / ANON_KEY)

import { readFileSync, writeFileSync } from 'node:fs'

/** What to ask USDA for, per staple id. Explicit, because a description is not always a good query. */
const QUERIES = {
  'seed:0': 'chicken breast raw',
  'seed:1': 'chicken thigh raw',
  'seed:2': 'ground beef 90 10 raw',
  'seed:3': 'salmon atlantic raw',
  'seed:4': 'egg whole raw',
  'seed:5': 'egg white raw',
  'seed:6': 'greek yogurt plain nonfat',
  'seed:7': 'milk 2% reduced fat',
  'seed:8': 'cheddar cheese',
  'seed:9': 'cottage cheese 2%',
  'seed:10': 'whey protein isolate',
  'seed:11': 'tofu firm',
  'seed:12': 'black beans cooked',
  'seed:13': 'lentils cooked',
  'seed:14': 'chickpeas cooked',
  'seed:15': 'rice white long grain cooked',
  'seed:16': 'rice brown cooked',
  'seed:17': 'pasta cooked',
  'seed:18': 'bread whole wheat',
  'seed:19': 'oats rolled dry',
  'seed:20': 'potato russet raw',
  'seed:21': 'sweet potato raw',
  'seed:22': 'quinoa cooked',
  'seed:23': 'tortilla flour',
  'seed:24': 'banana raw',
  'seed:25': 'apple raw with skin',
  'seed:26': 'blueberries raw',
  'seed:27': 'strawberries raw',
  'seed:28': 'orange raw',
  'seed:29': 'avocado raw',
  'seed:30': 'broccoli raw',
  'seed:31': 'spinach raw',
  'seed:32': 'carrot raw',
  'seed:33': 'peppers sweet red raw',
  'seed:34': 'tomato raw',
  'seed:35': 'onion raw',
  'seed:36': 'olive oil',
  'seed:37': 'butter salted',
  'seed:38': 'peanut butter',
  'seed:39': 'almonds raw',
  'seed:40': 'walnuts raw',
  'seed:41': 'honey',
  'seed:42': 'sugar granulated',
  'seed:43': 'coffee brewed',
  'seed:44': 'beer regular',
  'seed:45': 'wine red table',
}

const MICROS = [
  'fiberMg',
  'sugarMg',
  'satFatMg',
  'sodiumMg',
  'potassiumMg',
  'cholesterolMg',
  'calciumMg',
  'ironMg',
]

/**
 * Whether a candidate is the same food, to the precision that matters here.
 *
 * Energy within 12%, and protein within 12% *or* 2 g absolute — the absolute leg is what lets olive oil
 * and honey through, where a relative test on 0 g of protein can never pass.
 */
function isSameFood(staple, candidate) {
  const near = (a, b, tol, abs = 0) =>
    Math.abs(a - b) <= Math.max(abs, Math.max(Math.abs(a), Math.abs(b)) * tol)
  return (
    near(staple.kcal, candidate.kcal, 0.12, 5) &&
    near(staple.proteinMg, candidate.proteinMg, 0.12, 2000) &&
    near(staple.carbsMg, candidate.carbsMg, 0.2, 3000) &&
    near(staple.fatMg, candidate.fatMg, 0.2, 2000)
  )
}

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
    .map((line) => {
      const at = line.indexOf('=')
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()]
    }),
)
const URL_BASE = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_ANON_KEY
if (!URL_BASE || !KEY) throw new Error('.env needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY')

const path = new URL('../src/db/seed/staples.ts', import.meta.url)
const source = readFileSync(path, 'utf8')
const start = source.indexOf('\n[')
const staples = JSON.parse(source.slice(start, source.lastIndexOf(']') + 1))

let filled = 0
let unmatched = 0
const report = []

for (const staple of staples) {
  const query = QUERIES[staple.id]
  const missing = MICROS.filter((key) => staple.per100[key] === null)
  if (!query || missing.length === 0) continue

  let candidates = []
  try {
    const response = await fetch(`${URL_BASE}/functions/v1/foods`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'search', q: query, limit: 25 }),
    })
    if (response.ok) candidates = (await response.json()).foods ?? []
  } catch {
    candidates = []
  }

  // Generic rows only: a branded one carries the label's rounding and often nothing but macros.
  const match = candidates
    .filter((food) => (food.dataType ?? '').toLowerCase() !== 'branded')
    .find((food) => isSameFood(staple.per100, food.per100))

  if (!match) {
    unmatched += 1
    report.push(`  ✗ ${staple.description} — no generic row with matching macros; left as-is`)
    continue
  }

  const got = []
  for (const key of missing) {
    if (match.per100[key] === null || match.per100[key] === undefined) continue
    staple.per100[key] = match.per100[key]
    got.push(key.replace('Mg', ''))
  }
  if (got.length > 0) filled += 1
  report.push(
    `  ${got.length > 0 ? '✓' : '·'} ${staple.description.padEnd(34)} ${match.description.slice(0, 40).padEnd(42)} ${got.join(' ') || '(nothing to take)'}`,
  )
}

writeFileSync(
  path,
  source.slice(0, start) + '\n' + JSON.stringify(staples, null, 2) + '\n',
)

console.log(report.join('\n'))
console.log(`\nFilled ${filled} of ${staples.length} staples; ${unmatched} left unchanged.`)
