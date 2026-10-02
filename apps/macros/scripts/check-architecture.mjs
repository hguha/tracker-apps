// Architecture + consistency guard (npm run lint): fails on an upward cross-layer import, a
// feature reaching into @/db, a raw ms literal instead of DAY_MS/WEEK_MS, or nutrient
// arithmetic outside lib/nutrition.ts. A checker rather than ESLint because
// typescript-eslint doesn't yet support this repo's TypeScript 7 (typescript-eslint#10940).

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src')

const FORBIDDEN = {
  domain: ['lib', 'db', 'data', 'sync', 'auth', 'backend', 'platform', 'components', 'features', 'app'],
  lib: ['db', 'data', 'sync', 'auth', 'backend', 'platform', 'components', 'features', 'app'],
  data: ['sync', 'auth', 'components', 'features', 'app'],
  components: ['db', 'data', 'sync', 'auth', 'backend', 'features', 'app'],
  features: ['db'],
}

// Nothing is exempt yet: every screen goes through data/repository.
const DB_EXCEPTIONS = new Set([])

/**
 * Nutrient arithmetic belongs to lib/nutrition.ts alone. REPutation learned this the hard
 * way — a second copy of its volume formula had the coach and the home screen reporting
 * different numbers for the same week — so the rule is enforced here from day one.
 *
 * Scoped to the macro mg fields, not `kcal`: calories are legitimately arithmetic in
 * lib/expenditure.ts, and "kcal" appears in ordinary prose.
 */
const MACRO_MATH_RE = /\b(?:proteinMg|carbsMg|fatMg)\s*[*/]|[*/]\s*(?:proteinMg|carbsMg|fatMg)\b/

/** Hand-rolled gram/milligram conversion: use gramsToMg / mgToGrams. */
const MG_CONVERSION_RE = /[*/]\s*1000\b/

const IMPORT_RE = /(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const MS_LITERAL_RE = /\b(?:86_?400_?000|604_?800_?000)\b/

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

const layerOf = (rel) => rel.split('/')[0]

const violations = []
for (const file of walk(SRC)) {
  const rel = relative(SRC, file)
  const layer = layerOf(rel)
  const source = readFileSync(file, 'utf8')

  if (MS_LITERAL_RE.test(source)) {
    violations.push(`${rel}: raw ms literal — use DAY_MS / WEEK_MS from @tracker-engine/core`)
  }

  if (rel !== 'lib/nutrition.ts' && MACRO_MATH_RE.test(source)) {
    violations.push(`${rel}: nutrient arithmetic outside lib/nutrition.ts`)
  }

  if (rel !== 'lib/nutrition.ts' && MG_CONVERSION_RE.test(source)) {
    violations.push(`${rel}: hand-rolled mg conversion — use gramsToMg / mgToGrams`)
  }

  const forbidden = FORBIDDEN[layer]
  if (!forbidden) continue

  for (const match of source.matchAll(IMPORT_RE)) {
    const spec = match[1] ?? match[2]
    if (!spec?.startsWith('@/')) continue
    const target = spec.slice(2).split('/')[0]
    if (!forbidden.includes(target)) continue
    if (target === 'db' && DB_EXCEPTIONS.has(rel)) continue
    violations.push(
      `${rel}: imports @/${target}/* — a '${layer}' module may not depend on '${target}'.`,
    )
  }
}

if (violations.length > 0) {
  console.error(`\nArchitecture check failed (${violations.length}):\n`)
  for (const v of violations.sort()) console.error(`  ✗ ${v}`)
  console.error('')
  process.exit(1)
}
console.log('Architecture check passed — layering and calc-consistency rules hold.')
