import type { SyncSchema } from '@tracker-engine/local-first'
import { db } from '@/db'

const STORES = {
  profiles: db.profiles,
  programs: db.programs,
  recipes: db.recipes,
  mealTemplates: db.mealTemplates,
  bodyWeights: db.bodyWeights,
  logEntries: db.logEntries,
  checkIns: db.checkIns,
  foods: db.foods,
  customFoods: db.customFoods,
} as const

export const macroSyncSchema: SyncSchema = {
  // Parents before children: a log entry may point at a recipe.
  tables: Object.keys(STORES),
  // Reference data the server owns; the drain never pushes it.
  serverAuthored: ['foods'],

  parentIdOf: (table, row) =>
    table === 'logEntries' ? ((row.recipeId as string | null) ?? undefined) : undefined,

  // Postgres omits empty jsonb arrays as null, which would throw on iterate.
  normalize: (table, row) => {
    if (table === 'recipes') {
      return { ...row, ingredients: row.ingredients ?? [], steps: row.steps ?? [], tags: row.tags ?? [] }
    }
    if (table === 'mealTemplates') return { ...row, items: row.items ?? [] }
    if (table === 'foods' || table === 'customFoods') {
      return { ...row, portions: row.portions ?? [] }
    }
    return row
  },

  store: (table) => {
    const store = STORES[table as keyof typeof STORES]
    if (!store) throw new Error(`Unknown synced table "${table}"`)
    return store as unknown as SyncSchema extends { store(t: string): infer S } ? S : never
  },

  // Children before parents. `foods` is absent on purpose: shared reference data nobody
  // owns, so an account erase must not delete it.
  eraseOrder: [
    'logEntries',
    'customFoods',
    'checkIns',
    'bodyWeights',
    'mealTemplates',
    'recipes',
    'programs',
    'profiles',
  ],
}
