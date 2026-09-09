import { getSupabase } from '@/backend/supabaseClient'

/**
 * Importing a recipe from a link.
 *
 * Two steps on purpose. The page supplies the *text* — its name, how many it serves, and its
 * ingredient lines as written — via `recipe-import`, which runs server-side because recipe sites
 * send no CORS headers. The model then turns "1/2 pound lean ground beef" into a food name and a
 * weight, and the client matches that to a real food row. Nothing nutritional is ever taken from
 * the web page, so a site's own (frequently wrong) calorie box can't get into the log.
 */

export interface ImportedRecipe {
  name: string
  servings: number | null
  /** Verbatim lines, kept so the user can see what was read before anything is converted. */
  ingredients: string[]
  steps: string[]
  sourceUrl: string
}

export class RecipeImportError extends Error {}

export async function importRecipeFromUrl(url: string): Promise<ImportedRecipe> {
  const client = getSupabase()
  if (!client) {
    throw new RecipeImportError('Importing a link needs a connection and an account.')
  }

  const { data, error } = await client.functions.invoke<ImportedRecipe & { error?: string }>(
    'recipe-import',
    { body: { url } },
  )

  // A 4xx carries the useful message, and supabase-js hides the body of a non-2xx behind the
  // error — so the fallback text has to stand on its own.
  if (error || !data || data.error || !Array.isArray(data.ingredients)) {
    throw new RecipeImportError(
      data?.error ??
        "Couldn't read a recipe from that page. Paste the ingredients into the box instead.",
    )
  }
  if (data.ingredients.length === 0) {
    throw new RecipeImportError('That page has no ingredient list the app can read.')
  }
  return data
}
