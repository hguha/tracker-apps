import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { dayKey } from '@tracker-engine/core'
import { Card } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { dayTotals, mgToGrams, perServing, remaining } from '@/lib/nutrition'
import { suggestFoods } from '@/lib/suggest'
import { recommendRecipes } from '@/lib/recommend'
import { CUISINE_LABELS } from '@/lib/cuisine'
import { MacroNumbers } from '@/features/shared/MacroNumbers'
import { Empty } from './browseRows'
import type { Loggable } from './loggable'

/**
 * What still fits today: foods and recipes together, ranked by what's left.
 *
 * Both in one list because the question doesn't distinguish them — "I have 600 kcal and 40 g of
 * protein left" is answered as readily by a tin of tuna as by a recipe, and making the user pick a
 * category first is making them do the sorting.
 */
export function FitsPanel({ onOpen }: { onOpen: (loggable: Loggable) => void }) {
  const today = dayKey(Date.now())
  // `undefined` until loaded: given `null`, the screen opened on "No target yet" for a frame, which
  // is a statement about the account rather than about the query, and a wrong one.
  const targets = useLiveQuery(() => repo.currentTargets(), [], undefined)
  const todayEntries = useLiveQuery(() => repo.entriesForDay(today), [today], undefined)
  const frequentIds = useLiveQuery(() => repo.frequentFoodIds(40), [], [])
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)
  const recipes = useLiveQuery(() => repo.recipes(), [], [])
  const usage = useLiveQuery(() => repo.recipeUsage(), [], new Map())
  const recentCuisines = useLiveQuery(() => repo.recentRecipeCuisines(), [], [])

  const candidateIds = [
    ...(profile?.favouriteFoodIds ?? []),
    ...(frequentIds ?? []).filter((id) => !(profile?.favouriteFoodIds ?? []).includes(id)),
  ]
  const candidates = useLiveQuery(
    async () => {
      const found = await repo.foodsByIds(candidateIds)
      return candidateIds.flatMap((id) => {
        const food = found.get(id)
        return food ? [food] : []
      })
    },
    [candidateIds.join(',')],
    [],
  )

  const isLoaded = targets !== undefined && todayEntries !== undefined
  const left = targets ? remaining(dayTotals(todayEntries ?? []), targets) : null
  const foods = useMemo(
    () => (left ? suggestFoods(left, candidates ?? []) : []),
    [left, candidates],
  )
  const cookable = useMemo(
    () =>
      recommendRecipes({
        remainingKcal: left?.kcal ?? null,
        remainingProteinMg: left?.proteinMg ?? 0,
        recipes: recipes ?? [],
        usage: usage ?? new Map(),
        recentCuisines: recentCuisines ?? [],
        today,
      }),
    [left?.kcal, left?.proteinMg, recipes, usage, recentCuisines, today],
  )

  return (
    <div className="space-y-3 px-3 py-3">
      <Card className="p-3.5">
        <h2 className="text-[15px] font-semibold tracking-tight">What still fits</h2>
        <p className="mt-0.5 text-[12.5px] text-ink-muted">
          {!isLoaded
            ? 'Working out what is left…'
            : left === null
              ? 'No target yet, so there is nothing to fit inside. Log for a week and weigh in, and the app works one out.'
              : `${left.kcal} kcal and ${Math.round(mgToGrams(left.proteinMg))} g of protein left today.`}
        </p>
      </Card>

      {cookable.length > 0 && (
        <Card className="p-0">
          <h2 className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Cook one of these
          </h2>
          <ul className="divide-y divide-line">
            {cookable.map(({ recipe, why }) => (
              <li key={recipe.id}>
                <button
                  onClick={() => onOpen({ kind: 'recipe', recipe })}
                  className="w-full px-4 py-2.5 text-left active:bg-sunken"
                >
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-[14px]">{recipe.name}</span>
                    {recipe.cuisine && (
                      <span className="shrink-0 text-[11px] text-ink-muted">
                        {CUISINE_LABELS[recipe.cuisine]}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 flex items-baseline gap-2">
                    <span className="tabular shrink-0 text-[12px] font-semibold">
                      {perServing(recipe).kcal} kcal
                    </span>
                    <MacroNumbers nutrients={perServing(recipe)} />
                  </span>
                  <span className="tabular block text-[11.5px] text-ink-muted">{why}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {foods.length > 0 && (
        <Card className="p-0">
          <h2 className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Or something you already eat
          </h2>
          <ul className="divide-y divide-line">
            {foods.map((suggestion) => (
              <li key={suggestion.food.id}>
                <button
                  onClick={() => onOpen({ kind: 'food', food: suggestion.food })}
                  className="w-full px-4 py-2.5 text-left active:bg-sunken"
                >
                  <div className="truncate text-[14px]">{suggestion.food.description}</div>
                  <div className="tabular text-[12px] text-ink-muted">{suggestion.why}</div>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {isLoaded && left !== null && foods.length === 0 && cookable.length === 0 && (
        <Empty>
          Nothing in your list fits what&rsquo;s left. That usually means the day is nearly full —
          search for something small, or leave it here.
        </Empty>
      )}
    </div>
  )
}
