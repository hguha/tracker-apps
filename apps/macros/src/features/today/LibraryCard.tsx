import { useLiveQuery } from 'dexie-react-hooks'
import { dayKey } from '@tracker-engine/core'
import { Card } from '@tracker-engine/ui'
import { ChefHat, ChevronRight } from 'lucide-react'
import * as repo from '@/data/repository'
import { dayTotals, remaining } from '@/lib/nutrition'
import { recommendRecipes } from '@/lib/recommend'
import { CUISINE_LABELS } from '@/lib/cuisine'

/**
 * The library, and the top of what to cook from it.
 *
 * Recipes and saved meals were reachable only from Settings, which is where features go to be
 * forgotten: nobody browses Settings at 6pm wondering what's for dinner. So the route lives here,
 * with the three best suggestions already on it — ranked by what fits tonight's remaining calories,
 * what the user actually cooks, and what they haven't had lately.
 *
 * Each row opens *that* recipe. It used to open the list — so tapping "Sunday chilli" made you find
 * "Sunday chilli" again — and carried a "Log 1" button beside it, which wrote a whole serving into the
 * day from the home screen with no confirmation and no sight of what was in it.
 */
export function LibraryCard({
  onOpenRecipes,
  onOpenRecipe,
}: {
  onOpenRecipes: () => void
  /** Opens one recipe. A named row that leads to a list of rows is a broken link. */
  onOpenRecipe: (recipeId: string) => void
}) {
  const recipes = useLiveQuery(() => repo.recipes(), [], [])
  const usage = useLiveQuery(() => repo.recipeUsage(), [], new Map())
  const recentCuisines = useLiveQuery(() => repo.recentRecipeCuisines(), [], [])
  const targets = useLiveQuery(() => repo.currentTargets(), [], null)
  const today = dayKey(Date.now())
  const entries = useLiveQuery(() => repo.entriesForDay(today), [today], [])

  // Shown even with no recipes, because this is the only route to the library from home — but as a
  // one-line invitation rather than an empty list pretending to be a feature.
  const isEmpty = (recipes ?? []).length === 0

  const left = targets ? remaining(dayTotals(entries ?? []), targets) : null
  const rows = isEmpty ? [] : recommendRecipes(
    {
      remainingKcal: left?.kcal ?? null,
      remainingProteinMg: left?.proteinMg ?? 0,
      recipes: recipes ?? [],
      usage: usage ?? new Map(),
      recentCuisines: recentCuisines ?? [],
      today,
    },
    3,
  )

  return (
    <Card className="p-0">
      <button
        onClick={onOpenRecipes}
        className="flex w-full items-center gap-2 px-4 py-3 text-left active:bg-sunken"
      >
        <ChefHat size={16} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold tracking-tight">Your library</span>
          <span className="block text-[12px] text-ink-muted">
            {isEmpty
              ? 'Recipes, saved meals and your own foods'
              : rows.length === 0
                ? `${(recipes ?? []).length} recipes · saved meals · your own foods`
                : left === null
                  ? `${(recipes ?? []).length} recipes to cook, plus saved meals and foods`
                  : `Ranked against the ${left.kcal} kcal you have left`}
          </span>
        </span>
        <ChevronRight size={17} className="shrink-0 text-ink-muted" />
      </button>

      <ul className="divide-y divide-line border-t border-line">
        {rows.map(({ recipe, why }) => (
          <li key={recipe.id}>
            <button
              onClick={() => onOpenRecipe(recipe.id)}
              className="w-full px-4 py-2 text-left active:bg-sunken"
            >
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-[13.5px]">{recipe.name}</span>
                {recipe.cuisine && (
                  <span className="shrink-0 text-[11px] text-ink-muted">
                    {CUISINE_LABELS[recipe.cuisine]}
                  </span>
                )}
              </span>
              <span className="tabular block text-[11.5px] text-ink-muted">{why}</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
