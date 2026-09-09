import { getSupabase } from '@/backend/supabaseClient'
import { parseCuisine } from '@/lib/cuisine'
import type { CuisineKey } from '@/domain/types'

/**
 * Importing a recipe from a link.
 *
 * Two steps on purpose, and — since the first attempt at this — two *visible* steps. The page
 * supplies the text via `recipe-import`, which runs server-side because recipe sites send no CORS
 * headers. A model then turns "1/2 pound lean ground beef" into a food name and a weight, and the
 * client matches that to a real food row. Nothing nutritional is ever taken from the web page, so a
 * site's own (frequently wrong) calorie box can't get into the log.
 *
 * The reason the split is visible: converting nineteen ingredient lines takes the better part of a
 * minute, and the original bundled both calls behind one spinner. That made a working import look
 * like a hang, and — worse — a failure in the slow second half threw away the name, the servings
 * and all nineteen lines that the fast first half had already read successfully.
 */

export interface ImportedRecipe {
  name: string
  servings: number | null
  /** Verbatim lines, kept so the user can see what was read before anything is converted. */
  ingredients: string[]
  steps: string[]
  cuisine: CuisineKey | null
  /** Whatever the page called the cuisine or category, when it didn't map onto the closed list. */
  tags: string[]
  totalMinutes: number | null
  sourceUrl: string
}

export class RecipeImportError extends Error {}

interface RawImport {
  name?: unknown
  servings?: unknown
  ingredients?: unknown
  steps?: unknown
  cuisine?: unknown
  category?: unknown
  totalMinutes?: unknown
  sourceUrl?: unknown
  error?: string
}

export async function importRecipeFromUrl(url: string): Promise<ImportedRecipe> {
  const client = getSupabase()
  if (!client) {
    throw new RecipeImportError('Reading a link needs a connection and an account.')
  }

  const { data, error } = await client.functions.invoke<RawImport>('recipe-import', {
    body: { url },
  })

  // The function answers 200 even when it failed, precisely so this message is the function's own
  // and not a guess — see the `json` helper there.
  if (data?.error) throw new RecipeImportError(data.error)
  if (error || !data || !Array.isArray(data.ingredients)) {
    throw new RecipeImportError(
      "Couldn't reach the importer. Copy the ingredient list and paste it in instead.",
    )
  }
  const ingredients = data.ingredients.filter((line): line is string => typeof line === 'string')
  if (ingredients.length === 0) {
    throw new RecipeImportError('That page has no ingredient list the app can read.')
  }

  // The cuisine the page states is the best evidence there is; its category ("Soup", "Main
  // Course") is a fallback that occasionally carries one — "Italian Recipes" is a common category.
  const cuisine = parseCuisine(asText(data.cuisine)) ?? parseCuisine(asText(data.category))
  const stated = [asText(data.cuisine), asText(data.category)].filter((value) => value.length > 0)

  return {
    name: asText(data.name) || 'Imported recipe',
    servings: asCount(data.servings),
    ingredients,
    steps: Array.isArray(data.steps)
      ? data.steps.filter((step): step is string => typeof step === 'string')
      : [],
    cuisine,
    // Kept even when a cuisine was recognised: "Soup" is worth having, and the words the source
    // used are the only record of why this recipe was filed where it was.
    tags: stated,
    totalMinutes: asCount(data.totalMinutes),
    sourceUrl: asText(data.sourceUrl) || url,
  }
}

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const asCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null
