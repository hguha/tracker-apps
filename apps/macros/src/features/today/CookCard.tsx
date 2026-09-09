import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { dayKey } from '@tracker-engine/core'
import { Card, useToast } from '@tracker-engine/ui'
import { ChefHat, ChevronRight, Plus } from 'lucide-react'
import * as repo from '@/data/repository'
import { dayTotals, perServing, remaining } from '@/lib/nutrition'
import { recommendRecipes } from '@/lib/recommend'
import { CUISINE_LABELS } from '@/lib/cuisine'
import { mealForHour } from '@/features/shared/meals'

/**
 * What to cook, on the screen people actually open.
 *
 * Recipes were previously reachable only from Settings, which is where features go to be forgotten:
 * nobody browses Settings at 6pm wondering what's for dinner. Three suggestions here, ranked by
 * what fits tonight's remaining calories, what the user actually cooks, and what they haven't had
 * lately — with logging a serving as one tap.
 *
 * Hidden entirely when there are no recipes. An empty card advertising a feature is worse than no
 * card; the Log screen's "New recipe" is where that invitation belongs.
 */
export function CookCard({ onOpenRecipes }: { onOpenRecipes: () => void }) {
  const toast = useToast()
  const [logging, setLogging] = useState<string | null>(null)

  const recipes = useLiveQuery(() => repo.recipes(), [], [])
  const usage = useLiveQuery(() => repo.recipeUsage(), [], new Map())
  const recentCuisines = useLiveQuery(() => repo.recentRecipeCuisines(), [], [])
  const targets = useLiveQuery(() => repo.currentTargets(), [], null)
  const today = dayKey(Date.now())
  const entries = useLiveQuery(() => repo.entriesForDay(today), [today], [])

  if ((recipes ?? []).length === 0) return null

  const left = targets ? remaining(dayTotals(entries ?? []), targets) : null
  const rows = recommendRecipes(
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
  if (rows.length === 0) return null

  return (
    <Card className="p-0">
      <button
        onClick={onOpenRecipes}
        className="flex w-full items-center gap-2 px-4 py-3 text-left active:bg-sunken"
      >
        <ChefHat size={16} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold tracking-tight">Cook one of yours</span>
          <span className="block text-[12px] text-ink-muted">
            {left === null
              ? `${(recipes ?? []).length} recipes saved`
              : `Ranked against the ${left.kcal} kcal you have left`}
          </span>
        </span>
        <ChevronRight size={17} className="shrink-0 text-ink-muted" />
      </button>

      <ul className="divide-y divide-line border-t border-line">
        {rows.map(({ recipe, why }) => (
          <li key={recipe.id} className="flex items-center">
            <button
              onClick={onOpenRecipes}
              className="min-w-0 flex-1 px-4 py-2 text-left active:bg-sunken"
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
            <button
              disabled={logging !== null}
              onClick={() => {
                if (logging !== null) return
                setLogging(recipe.id)
                void repo
                  .logRecipeServing(recipe, 1, mealForHour(new Date().getHours()))
                  .then(() => toast.show(`Logged ${perServing(recipe).kcal} kcal · ${recipe.name}`))
                  .finally(() => setLogging(null))
              }}
              aria-label={`Log one serving of ${recipe.name}`}
              className="mr-2 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-wash text-accent active:opacity-60"
            >
              <Plus size={16} />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
