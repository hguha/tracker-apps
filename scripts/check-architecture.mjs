// Architecture + consistency guard (run by `npm run lint`).
//
// Enforces the layering and the specific divergences we consolidated, so a future
// edit that re-introduces one fails CI instead of shipping. This is a purpose-built
// import/literal checker rather than ESLint because typescript-eslint does not yet
// support this repo's TypeScript 7 (tracking: typescript-eslint#10940); the rules
// here are path/literal based and need no type information. Swap to ESLint's
// import-boundary rules once TS 7 is supported.
//
// Layers may import only themselves + lower:
//   domain → (nothing)   lib → domain   platform/backend/db → domain, lib
//   data → +db,+backend   sync → +data   auth → +backend
//   components → +platform   features → everything except @/db*   app → everything

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src')

// Layers each layer is NOT allowed to import from (upward / sideways-forbidden).
const FORBIDDEN = {
  domain: ['lib', 'db', 'data', 'sync', 'auth', 'backend', 'platform', 'components', 'features', 'app'],
  lib: ['db', 'data', 'sync', 'auth', 'backend', 'platform', 'components', 'features', 'app'],
  data: ['sync', 'auth', 'components', 'features', 'app'],
  components: ['db', 'data', 'sync', 'auth', 'backend', 'features', 'app'],
  // features may import all layers EXCEPT reaching into Dexie directly (@/db).
  features: ['db'],
}

// Files exempt from the features→db ban: a device-local chat store and two
// persistence-diagnostics screens that legitimately read low-level tables.
const DB_EXCEPTIONS = new Set([
  'features/coach/history.ts',
  'features/profile/DataScreen.tsx',
  'features/auth/AccountScreen.tsx',
])

const IMPORT_RE = /(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
// Raw ms spans that should be DAY_MS / WEEK_MS from lib/dates.
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

  // lib/dates itself defines the constants; everything else uses them.
  if (rel !== 'lib/dates.ts' && MS_LITERAL_RE.test(source)) {
    violations.push(`${rel}: raw ms literal — use DAY_MS / WEEK_MS from @/lib/dates`)
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
