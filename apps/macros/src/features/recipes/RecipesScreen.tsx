import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { dayKey, formatRelativeDay } from '@tracker-engine/core'
import {
  Button,
  Card,
  FilterChipButton,
  FilterSheet,
  Screen,
  SearchField,
  SegmentedTabs,
  type SegmentedTab,
} from '@tracker-engine/ui'
import { Plus } from 'lucide-react'
import * as repo from '@/data/repository'
import { dayTotals, perServing, remaining } from '@/lib/nutrition'
import { CUISINE_LABELS, cuisineLabel } from '@/lib/cuisine'
import { cuisinesPresent, recommendRecipes } from '@/lib/recommend'
import { grams } from '@/features/shared/format'
import { RecipeDetail } from './RecipeDetail'
import { RecipeEditor } from './RecipeEditor'
import type { CuisineKey, Recipe } from '@/domain/types'

type SortKey = 'suggested' | 'name' | 'often' | 'recent' | 'light'

const SORTS: SegmentedTab<SortKey>[] = [
  { key: 'suggested', label: 'Suggested' },
  { key: 'often', label: 'Most cooked' },
  { key: 'recent', label: 'Newest' },
  { key: 'light', label: 'Fewest kcal' },
  { key: 'name', label: 'A–Z' },
]

type Route = { kind: 'list' } | { kind: 'detail'; id: string } | { kind: 'edit'; id: string | null }

/**
 * Recipes: a dish you cook, divided into servings.
 *
 * Distinct from a saved meal, which is "log these exact items again". A recipe has a yield, so a
 * batch cooked on Sunday can be logged a third at a time all week without re-entering anything.
 *
 * The default order is Suggested rather than alphabetical, because the question this screen is
 * usually open to answer is "what should I cook", not "where is the chilli" — and a search box
 * answers the second one in fewer taps than scrolling an A–Z list.
 */
export function RecipesScreen({
  onBack,
  header,
}: {
  onBack: () => void
  /** Rendered above the list — the library's tab strip, when it's hosting this screen. */
  header?: React.ReactNode
}) {
  const [route, setRoute] = useState<Route>({ kind: 'list' })
  const [sort, setSort] = useState<SortKey>('suggested')
  const [query, setQuery] = useState('')
  const [cuisines, setCuisines] = useState<string[]>([])
  const [isSheetOpen, setIsSheetOpen] = useState(false)

  const recipes = useLiveQuery(() => repo.recipes(), [], [])
  const usage = useLiveQuery(() => repo.recipeUsage(), [], new Map())
  const targets = useLiveQuery(() => repo.currentTargets(), [], null)
  const today = dayKey(Date.now())
  const todayEntries = useLiveQuery(() => repo.entriesForDay(today), [today], [])
  const recentCuisines = useLiveQuery(() => repo.recentRecipeCuisines(), [], [])

  const all = recipes ?? []
  const left = targets ? remaining(dayTotals(todayEntries ?? []), targets) : null

  // Ranked once for the whole list, so the "Suggested" order and each row's stated reason can't
  // disagree about why a recipe is where it is. Above the route branches, because hooks must run
  // in the same order on every render.
  const ranked = useMemo(
    () =>
      recommendRecipes(
        {
          remainingKcal: left?.kcal ?? null,
          remainingProteinMg: left?.proteinMg ?? 0,
          recipes: all,
          usage: usage ?? new Map(),
          recentCuisines: recentCuisines ?? [],
          today,
        },
        all.length,
      ),
    [all, usage, left?.kcal, left?.proteinMg, recentCuisines, today],
  )

  if (route.kind === 'edit') {
    return (
      <RecipeEditor
        recipeId={route.id}
        onBack={() => setRoute(route.id ? { kind: 'detail', id: route.id } : { kind: 'list' })}
      />
    )
  }
  if (route.kind === 'detail') {
    return (
      <RecipeDetail
        recipeId={route.id}
        onBack={() => setRoute({ kind: 'list' })}
        onEdit={() => setRoute({ kind: 'edit', id: route.id })}
      />
    )
  }

  const needle = query.trim().toLowerCase()
  const visible = all
    .filter((recipe) => cuisines.length === 0 || cuisines.includes(recipe.cuisine ?? 'none'))
    .filter((recipe) => needle === '' || matches(recipe, needle))
  const order = sortRecipes(visible, sort, ranked, usage ?? new Map())

  const available = cuisinesPresent(all)
  const isFiltered = needle !== '' || cuisines.length > 0

  return (
    <Screen
      title={header ? 'Your library' : 'Recipes'}
      onBack={onBack}
      action={
        // Only once there's a list to sit above. With none, the empty state's own button is the
        // better target and two "new recipe" buttons on one screen is just noise.
        all.length > 0 ? (
          <button
            onClick={() => setRoute({ kind: 'edit', id: null })}
            aria-label="New recipe"
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-accent active:bg-sunken"
          >
            <Plus size={16} />
            New
          </button>
        ) : undefined
      }
    >
      {header}
      {all.length === 0 ? (
        <>
          <Card className="p-4 text-[13.5px] text-ink-muted">
            Nothing yet. A recipe is worth it for anything you cook in a batch — enter the
            ingredients once, say how many servings it makes, then log a serving at a time. Paste a
            link and the whole list comes across.
          </Card>
          <Button className="w-full" onClick={() => setRoute({ kind: 'edit', id: null })}>
            <Plus size={16} />
            New recipe
          </Button>
        </>
      ) : (
        <>
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search recipes and ingredients"
          />

          {available.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto">
              <FilterChipButton
                label={
                  cuisines.length === 0
                    ? 'Cuisine'
                    : cuisines.length === 1
                      ? cuisineLabel(asCuisine(cuisines[0]!))
                      : `${cuisines.length} cuisines`
                }
                isActive={cuisines.length > 0}
                onClick={() => setIsSheetOpen(true)}
              />
              {isFiltered && (
                <button
                  onClick={() => {
                    setQuery('')
                    setCuisines([])
                  }}
                  className="shrink-0 px-2 text-[13px] font-semibold text-accent"
                >
                  Clear
                </button>
              )}
            </div>
          )}

          <SegmentedTabs tabs={SORTS} active={sort} onSelect={setSort} />

          {sort === 'suggested' && left === null && (
            <p className="px-1 text-[12px] text-ink-muted">
              Without a calorie target the order can only weigh what you cook and how recently —
              add your height, age and sex in Settings and it will fit tonight&rsquo;s budget too.
            </p>
          )}

          {order.length === 0 ? (
            <Card className="p-4 text-center text-[13.5px] text-ink-muted">
              Nothing matches these filters.
            </Card>
          ) : (
            <Card className="p-0">
              <ul className="divide-y divide-line">
                {order.map((recipe) => {
                  const each = perServing(recipe)
                  const cooked = usage?.get(recipe.id)
                  const why = sort === 'suggested' ? whyOf(ranked, recipe.id) : null
                  return (
                    <li key={recipe.id}>
                      <button
                        onClick={() => setRoute({ kind: 'detail', id: recipe.id })}
                        className="w-full px-4 py-2.5 text-left active:bg-sunken"
                      >
                        <span className="flex items-baseline gap-2">
                          <span className="min-w-0 flex-1 truncate text-[14px]">{recipe.name}</span>
                          {recipe.cuisine && (
                            <span className="shrink-0 rounded-full bg-sunken px-2 py-0.5 text-[11px] text-ink-secondary">
                              {CUISINE_LABELS[recipe.cuisine]}
                            </span>
                          )}
                        </span>
                        <span className="tabular mt-0.5 block text-[12px] text-ink-muted">
                          {why ??
                            `${each.kcal} kcal each · ${grams(each.proteinMg)}P ${grams(each.carbsMg)}C ${grams(each.fatMg)}F`}
                        </span>
                        <span className="block text-[11.5px] text-ink-muted">
                          makes {recipe.servings}
                          {cooked?.lastCookedDay
                            ? ` · last cooked ${formatRelativeDay(Date.parse(`${cooked.lastCookedDay}T12:00:00`)).toLowerCase()}`
                            : ' · never logged'}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </Card>
          )}
        </>
      )}

      {isSheetOpen && (
        <FilterSheet
          title="Cuisine"
          options={[
            ...available.map((key) => ({ value: key, label: CUISINE_LABELS[key] })),
            { value: 'none', label: 'Uncategorised' },
          ]}
          selected={cuisines}
          onChange={setCuisines}
          onDismiss={() => setIsSheetOpen(false)}
        />
      )}
    </Screen>
  )
}

/** Name, cuisine, or any ingredient — searching "chickpea" should find the curry. */
function matches(recipe: Recipe, needle: string): boolean {
  if (recipe.name.toLowerCase().includes(needle)) return true
  if (cuisineLabel(recipe.cuisine).toLowerCase().includes(needle)) return true
  if (recipe.tags.some((tag) => tag.toLowerCase().includes(needle))) return true
  return recipe.ingredients.some((ingredient) => ingredient.label.toLowerCase().includes(needle))
}

function sortRecipes(
  recipes: readonly Recipe[],
  sort: SortKey,
  ranked: readonly { recipe: Recipe; score: number }[],
  usage: ReadonlyMap<string, { timesCooked: number; lastCookedDay: string | null }>,
): Recipe[] {
  const rows = [...recipes]
  if (sort === 'suggested') {
    const rank = new Map(ranked.map((row, index) => [row.recipe.id, index]))
    return rows.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity))
  }
  if (sort === 'name') return rows.sort((a, b) => a.name.localeCompare(b.name))
  if (sort === 'recent') return rows.sort((a, b) => b.createdAt - a.createdAt)
  if (sort === 'light') return rows.sort((a, b) => perServing(a).kcal - perServing(b).kcal)
  return rows.sort(
    (a, b) => (usage.get(b.id)?.timesCooked ?? 0) - (usage.get(a.id)?.timesCooked ?? 0),
  )
}

const whyOf = (ranked: readonly { recipe: Recipe; why: string }[], id: string): string | null =>
  ranked.find((row) => row.recipe.id === id)?.why ?? null

const asCuisine = (value: string): CuisineKey | null =>
  value === 'none' ? null : (value as CuisineKey)
