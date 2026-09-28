import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { dayKey } from '@tracker-engine/core'
import { Card, SegmentedTabs, type SegmentedTab } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { dayTotals, mgToGrams, perServing, remaining } from '@/lib/nutrition'
import { suggestFoods } from '@/lib/suggest'
import { recommendRecipes } from '@/lib/recommend'
import { LoggableList } from '@/features/shared/LoggableList'
import type { MacroTargets, Nutrients } from '@/domain/types'
import { Empty } from './browseRows'
import type { Loggable, Suggestion } from '@/features/shared/loggable'

/**
 * What still fits today, from every source that can answer.
 *
 * One list, filterable — the question doesn't distinguish the kinds ("I have 600 kcal and 40 g of
 * protein left" is answered as readily by a tin of tuna as by a recipe), but the *mood* does: some
 * evenings you want to cook and some you want a yoghurt. So everything competes by default and the
 * filter narrows it, rather than the screen deciding for you.
 *
 * It used to draw on foods and recipes only, and only ever showed them as two fixed sections.
 */
type Source = 'all' | 'recipes' | 'saved' | 'foods'

const SOURCES: SegmentedTab<Source>[] = [
  { key: 'all', label: 'Anything' },
  { key: 'recipes', label: 'Cook' },
  { key: 'saved', label: 'Saved' },
  { key: 'foods', label: 'Foods' },
]

type Fit = Suggestion & { source: Exclude<Source, 'all'> }

export function FitsPanel({ onOpen }: { onOpen: (loggable: Loggable) => void }) {
  const today = dayKey(Date.now())
  const [source, setSource] = useState<Source>('all')

  // `undefined` until loaded: given `null`, the screen opened on "No target yet" for a frame, which
  // is a statement about the account rather than about the query, and a wrong one.
  const targets = useLiveQuery(() => repo.currentTargets(), [], undefined)
  const todayEntries = useLiveQuery(() => repo.entriesForDay(today), [today], undefined)
  const frequentIds = useLiveQuery(() => repo.frequentFoodIds(40), [], [])
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)
  const recipes = useLiveQuery(() => repo.recipes(), [], [])
  const templates = useLiveQuery(() => repo.mealTemplates(), [], [])
  const usage = useLiveQuery(() => repo.recipeUsage(), [], new Map())
  const recentCuisines = useLiveQuery(() => repo.recentRecipeCuisines(), [], [])

  const savedIds = profile?.favouriteFoodIds ?? []
  const candidateIds = [...savedIds, ...(frequentIds ?? []).filter((id) => !savedIds.includes(id))]
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

  const suggestions = useMemo((): Fit[] => {
    if (!left) return []
    const fromRecipes: Fit[] = recommendRecipes({
      remainingKcal: left.kcal,
      remainingProteinMg: left.proteinMg,
      recipes: recipes ?? [],
      usage: usage ?? new Map(),
      recentCuisines: recentCuisines ?? [],
      today,
    }).map(({ recipe, why }) => ({
      key: `r:${recipe.id}`,
      title: recipe.name,
      nutrients: perServing(recipe),
      detail: why,
      loggable: { kind: 'recipe', recipe },
      source: 'recipes',
    }))

    const fromFoods: Fit[] = suggestFoods(left, candidates ?? []).map((suggestion) => ({
      key: `f:${suggestion.food.id}`,
      title: suggestion.food.description,
      nutrients: suggestion.nutrients,
      detail: suggestion.why,
      loggable: { kind: 'food', food: suggestion.food },
      source: 'foods',
    }))

    const fromSaved: Fit[] = (templates ?? []).flatMap((template) => {
      const why = fitNote(template.nutrients, left)
      return why === null
        ? []
        : [
            {
              key: `m:${template.id}`,
              title: template.name,
              nutrients: template.nutrients,
              detail: why,
              loggable: { kind: 'meal' as const, template },
              source: 'saved' as const,
            },
          ]
    })

    // Interleaved rather than sectioned, so "Anything" is a genuine ranking and not three lists
    // stacked in a fixed order that always favours whatever happens to be on top.
    return [...fromRecipes, ...fromSaved, ...fromFoods].sort(
      (a, b) => fitGap(a.nutrients, left) - fitGap(b.nutrients, left),
    )
  }, [left, recipes, templates, usage, recentCuisines, candidates, today])

  const shown = source === 'all' ? suggestions : suggestions.filter((row) => row.source === source)

  return (
    <div className="space-y-3 px-3 py-3">
      <Card className="p-3.5">
        <h2 className="text-[15px] font-semibold tracking-tight">
          {!isLoaded
            ? 'What can I still have?'
            : left === null
              ? 'No target yet'
              : `${left.kcal} kcal and ${Math.round(mgToGrams(left.proteinMg))} g of protein left`}
        </h2>
        {left === null && isLoaded && (
          <p className="mt-0.5 text-[12.5px] text-ink-muted">
            Log for a week and weigh in, and the app works one out.
          </p>
        )}
      </Card>

      {left !== null && <SegmentedTabs tabs={SOURCES} active={source} onSelect={setSource} />}

      {shown.length > 0 && <LoggableList items={shown} onPick={(fit) => onOpen(fit.loggable)} />}

      {isLoaded && left !== null && shown.length === 0 && (
        <Empty>Nothing here fits what&rsquo;s left. Try a search.</Empty>
      )}
    </div>
  )
}

/** How far a portion is from filling the gap, in kcal. Lower is a better fit, over or under. */
function fitGap(nutrients: Nutrients, left: MacroTargets): number {
  return Math.abs(left.kcal - nutrients.kcal)
}

/**
 * Why a saved meal is worth offering, or null when it isn't.
 *
 * A whole meal is a coarser instrument than a single food, so the window is generous: anything from a
 * third of what's left up to a tenth over it. Past that the honest answer is "not this".
 */
function fitNote(nutrients: Nutrients, left: MacroTargets): string | null {
  if (left.kcal <= 0 || nutrients.kcal <= 0) return null
  const share = nutrients.kcal / left.kcal
  if (share > 1.1 || share < 0.33) return null
  const protein = Math.round(mgToGrams(nutrients.proteinMg))
  return `${Math.round(share * 100)}% of what's left · ${protein} g protein`
}
