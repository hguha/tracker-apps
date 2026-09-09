import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { dayKey, formatRelativeDay } from '@tracker-engine/core'
import {
  Card,
  ScreenHeader,
  SearchField,
  SegmentedTabs,
  type SegmentedTab,
} from '@tracker-engine/ui'
import { Camera, Check, ChefHat, Plus, PlusCircle, ScanLine, Sparkles } from 'lucide-react'
import { cn } from '@/lib/cn'
import { isBarcodeScanningAvailable } from '@/platform/barcode'
import * as repo from '@/data/repository'
import { dayTotals, perServing, remaining } from '@/lib/nutrition'
import { suggestFoods } from '@/lib/suggest'
import { recommendRecipes, type RecipeRecommendation } from '@/lib/recommend'
import { CUISINE_LABELS } from '@/lib/cuisine'
import { portionWithGrams } from '@/features/shared/format'
import { MEAL_LABELS } from '@/features/shared/meals'
import { SearchingRow } from '@/features/shared/FoodSearchPicker'
import { useFoodSearch } from '@/features/shared/useFoodSearch'
import type { Food, MealSlot, Venue } from '@/domain/types'
import { DescribePanel } from './DescribePanel'
import { MealPreviewSheet, type MealPreview } from './MealPreviewSheet'
import { MealTimePicker } from './MealTimePicker'
import { CustomFoodPanel } from './CustomFoodPanel'
import { PhotoPanel } from './PhotoPanel'
import { PortionPanel } from './PortionPanel'
import { QuickAddPanel } from './QuickAddPanel'
import { ScanPanel } from './ScanPanel'
import { RecipeEditor } from '@/features/recipes/RecipeEditor'
import type { LogTarget } from './target'

type Panel =
  | { kind: 'browse' }
  | { kind: 'portion'; food: Food }
  | { kind: 'describe' }
  | { kind: 'scan' }
  | { kind: 'photo' }
  | { kind: 'quick' }
  | { kind: 'custom'; name: string; barcode?: string }
  | { kind: 'recipe' }

type BrowseTab = 'suggested' | 'again' | 'often' | 'recipes' | 'saved'

/**
 * Adding food, as a screen rather than a sheet.
 *
 * One input, not a mode switch: the same text either matches foods or gets broken down as a
 * meal, because a person typing "turkey sandwich and an apple" has no way of knowing in advance
 * which of those the app can do. Everything else exists to avoid typing at all — the meals you
 * already eat, in tabs, so a long list of frequents doesn't bury the rest.
 */
export function LogScreen({
  meal: initialMeal,
  day,
  onClose,
}: {
  meal: MealSlot
  /** The day being added to. Absent means today. */
  day?: string
  onClose: () => void
}) {
  const [meal, setMeal] = useState<MealSlot>(initialMeal)
  // On a past day, keep the current clock time but move the date: a meal added to last Tuesday
  // still happened at *some* time of day, and stamping it midnight would put it before breakfast.
  const [at, setAt] = useState(() => atOnDay(day))
  const [venue, setVenue] = useState<Venue | null>(null)
  const [query, setQuery] = useState('')
  const [panel, setPanel] = useState<Panel>({ kind: 'browse' })

  const target: LogTarget = { meal, at, venue }

  // The recipe editor owns the whole screen: it has its own header, and a recipe is a different
  // job from logging today's food even though both start at the same "+".
  if (panel.kind === 'recipe') {
    return <RecipeEditor recipeId={null} onBack={() => setPanel({ kind: 'browse' })} />
  }

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader
        title={panel.kind === 'browse' ? `Add to ${MEAL_LABELS[meal].toLowerCase()}` : 'Add food'}
        onBack={() => (panel.kind === 'browse' ? onClose() : setPanel({ kind: 'browse' }))}
        action={
          panel.kind === 'browse' ? (
            <button
              onClick={() => setPanel({ kind: 'recipe' })}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-accent active:bg-sunken"
            >
              <ChefHat size={16} />
              New recipe
            </button>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-y-auto pb-8">
        {panel.kind === 'browse' && (
          <BrowsePanel
            target={target}
            query={query}
            onQuery={setQuery}
            onMeal={setMeal}
            onAt={setAt}
            onVenue={setVenue}
            onSelect={(food) => setPanel({ kind: 'portion', food })}
            onPanel={setPanel}
            onDone={onClose}
          />
        )}
        {panel.kind === 'portion' && (
          <PortionPanel food={panel.food} target={target} onDone={onClose} />
        )}
        {panel.kind === 'describe' && (
          <DescribePanel target={target} initialText={query} onDone={onClose} />
        )}
        {panel.kind === 'quick' && <QuickAddPanel target={target} onDone={onClose} />}
        {panel.kind === 'photo' && <PhotoPanel target={target} onDone={onClose} />}
        {panel.kind === 'custom' && (
          <CustomFoodPanel
            initialName={panel.name}
            initialBarcode={panel.barcode ?? null}
            onSaved={(food) => setPanel({ kind: 'portion', food })}
          />
        )}
        {panel.kind === 'scan' && (
          <ScanPanel
            onFound={(food) => setPanel({ kind: 'portion', food })}
            onCreate={(barcode) => setPanel({ kind: 'custom', name: '', barcode })}
          />
        )}
      </div>
    </div>
  )
}

function BrowsePanel({
  target,
  query,
  onQuery,
  onMeal,
  onAt,
  onVenue,
  onSelect,
  onPanel,
  onDone,
}: {
  target: LogTarget
  query: string
  onQuery: (query: string) => void
  onMeal: (meal: MealSlot) => void
  onAt: (at: number) => void
  onVenue: (venue: Venue | null) => void
  onSelect: (food: Food) => void
  onPanel: (panel: Panel) => void
  onDone: () => void
}) {
  const { meal, at, venue } = target
  const trimmed = query.trim()
  const isTyping = trimmed.length >= 2
  const [tab, setTab] = useState<BrowseTab>('suggested')
  const [preview, setPreview] = useState<MealPreview | null>(null)
  /**
   * Foods ticked for logging together.
   *
   * The speed difference between this app and MyFitnessPal was never the search — it was that four
   * foods took four round trips through a portion screen. Ticked foods log at the amount they were
   * last eaten in, which for anything eaten regularly is the right amount already.
   */
  const [picked, setPicked] = useState<Food[]>([])
  const [isLogging, setIsLogging] = useState(false)
  const toggle = (food: Food) =>
    setPicked((current) =>
      current.some((row) => row.id === food.id)
        ? current.filter((row) => row.id !== food.id)
        : [...current, food],
    )

  const { results, isSearching } = useFoodSearch(query)
  const frequentIds = useLiveQuery(() => repo.frequentFoodIds(40), [], [])
  const frequents = useLiveQuery(
    async () => [...(await repo.foodsByIds(frequentIds ?? [])).values()],
    [frequentIds],
    [],
  )
  const templates = useLiveQuery(() => repo.mealTemplates(), [], [])
  const recipes = useLiveQuery(() => repo.recipes(), [], [])
  const usage = useLiveQuery(() => repo.recipeUsage(), [], new Map())
  const recentCuisines = useLiveQuery(() => repo.recentRecipeCuisines(), [], [])
  const recents = useLiveQuery(() => repo.recentMeals(), [], [])
  const targets = useLiveQuery(() => repo.currentTargets(), [], null)
  const today = dayKey(Date.now())
  const todayEntries = useLiveQuery(() => repo.entriesForDay(today), [today], [])

  const left = targets ? remaining(dayTotals(todayEntries ?? []), targets) : null
  const suggestions = useMemo(
    () => (left ? suggestFoods(left, frequents ?? []) : []),
    [left, frequents],
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

  const logRecipe = (recipeId: string, servings: number) => {
    const recipe = (recipes ?? []).find((row) => row.id === recipeId)
    if (!recipe) return Promise.resolve(0)
    // A cooked recipe is eaten at home whatever the picker says, which is why this ignores
    // `venue` — see logRecipeServing.
    return repo.logRecipeServing(recipe, servings, meal, at).then(() => 1)
  }

  const canScan = isBarcodeScanningAvailable()
  // Worth offering a breakdown when the text names more than one thing. It leads only when the
  // search came up thin: a query with real matches is answered by those matches.
  const looksComposed = trimmed.split(/\s+/).length >= 2
  const describeRow =
    isTyping && looksComposed ? (
      <DescribeRow text={trimmed} onOpen={() => onPanel({ kind: 'describe' })} />
    ) : null
  // Only lead with the breakdown once the search has actually finished coming up thin.
  const describeLeads = !isSearching && results.length < 3

  const tabs: SegmentedTab<BrowseTab>[] = [
    { key: 'suggested', label: 'Suggested' },
    { key: 'again', label: 'Eat again', badge: (recents ?? []).length || undefined },
    { key: 'often', label: 'Frequent', badge: (frequents ?? []).length || undefined },
    { key: 'recipes', label: 'Recipes', badge: (recipes ?? []).length || undefined },
    { key: 'saved', label: 'Saved', badge: (templates ?? []).length || undefined },
  ]

  return (
    <div className="space-y-3 px-3 py-3">
      <Card className="p-3">
        <MealTimePicker
          meal={meal}
          at={at}
          venue={venue}
          onMeal={onMeal}
          onAt={onAt}
          onVenue={onVenue}
        />
      </Card>

      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <SearchField
            autoFocus
            value={query}
            onChange={onQuery}
            placeholder="Search a food, or describe a meal"
          />
        </div>
        {canScan && (
          <button
            onClick={() => onPanel({ kind: 'scan' })}
            aria-label="Scan a barcode"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-sunken text-ink-secondary active:opacity-60"
          >
            <ScanLine size={20} />
          </button>
        )}
        <button
          onClick={() => onPanel({ kind: 'photo' })}
          aria-label="Log from a photo"
          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-sunken text-ink-secondary active:opacity-60"
        >
          <Camera size={20} />
        </button>
        <button
          onClick={() => onPanel({ kind: 'quick' })}
          aria-label="Quick add macros"
          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-sunken text-ink-secondary active:opacity-60"
        >
          <Plus size={20} />
        </button>
      </div>

      {isTyping ? (
        <>
          {describeLeads && describeRow}
          <FoodList
            foods={results}
            onSelect={onSelect}
            picked={picked}
            onToggle={toggle}
            emptyLabel="Nothing matched."
            footer={isSearching ? <SearchingRow /> : null}
          />
          {!describeLeads && describeRow}
          <button
            onClick={() => onPanel({ kind: 'custom', name: trimmed })}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-sunken py-2.5 text-[13.5px] font-semibold text-accent active:opacity-60"
          >
            <PlusCircle size={15} />
            Add “{trimmed}” from its label
          </button>
        </>
      ) : (
        <>
          <SegmentedTabs tabs={tabs} active={tab} onSelect={setTab} />

          {tab === 'suggested' && (
            <>
              {/* What to cook leads, because it's the harder question and the one a list of
                  single foods can't answer. */}
              {cookable.length > 0 && (
                <Card className="p-0">
                  <h2 className="px-4 pb-1 pt-3 text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
                    Log one of your recipes
                  </h2>
                  <RecipeRows rows={cookable.slice(0, 3)} onPreview={setPreview} onLog={logRecipe} />
                </Card>
              )}

              {suggestions.length === 0 && cookable.length === 0 ? (
                <Empty>
                  {left === null
                    ? 'Suggestions need a calorie target — add your height, age and sex in Settings.'
                    : `Only ${left.kcal} kcal left, which isn't enough to build a suggestion around.`}
                </Empty>
              ) : (
                suggestions.length > 0 && (
                  <Card className="p-0">
                    <h2 className="px-4 pb-1 pt-3 text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
                      Or a single food
                    </h2>
                    <ul className="divide-y divide-line">
                      {suggestions.map((suggestion) => (
                        <li key={suggestion.food.id}>
                          <button
                            onClick={() => onSelect(suggestion.food)}
                            className="w-full px-4 py-2.5 text-left active:bg-sunken"
                          >
                            <div className="truncate text-[14px]">
                              {suggestion.food.description}
                            </div>
                            <div className="tabular text-[12px] text-ink-muted">
                              {suggestion.why}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )
              )}
            </>
          )}

          {tab === 'again' &&
            ((recents ?? []).length === 0 ? (
              <Empty>Meals you log will show up here to repeat.</Empty>
            ) : (
              <Card className="p-0">
                <ul className="divide-y divide-line">
                  {(recents ?? []).map((recent) => (
                    <li key={`${recent.day}|${recent.meal}`}>
                      <button
                        onClick={() =>
                          setPreview({
                            title: `${MEAL_LABELS[recent.meal]} · ${formatRelativeDay(
                              Date.parse(`${recent.day}T12:00:00`),
                            )}`,
                            subtitle: `${recent.entries.length} item${
                              recent.entries.length === 1 ? '' : 's'
                            } · ${recent.nutrients.kcal} kcal`,
                            items: recent.entries.map((entry) => ({
                              foodId: entry.foodId,
                              label: entry.note || 'Quick add',
                              grams: entry.grams,
                              nutrients: entry.nutrients,
                            })),
                            nutrients: recent.nutrients,
                            log: (multiple) =>
                              repo.relogEntries(recent.entries, {
                                meal,
                                at,
                                multiple,
                                // Only override what the original said if the user has answered
                                // for this sitting; otherwise the old venue is the better guess.
                                ...(venue === null ? {} : { venue }),
                              }),
                          })
                        }
                        className="w-full px-4 py-2.5 text-left active:bg-sunken"
                      >
                        <div className="truncate text-[14px]">
                          {MEAL_LABELS[recent.meal]}{' '}
                          <span className="text-ink-muted">
                            · {formatRelativeDay(Date.parse(`${recent.day}T12:00:00`))}
                          </span>
                        </div>
                        <div className="tabular text-[12px] text-ink-muted">
                          {recent.nutrients.kcal} kcal · {recent.entries.length} item
                          {recent.entries.length === 1 ? '' : 's'}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}

          {tab === 'often' &&
            ((frequents ?? []).length === 0 ? (
              <Empty>Foods you log more than once collect here.</Empty>
            ) : (
              <FoodList
                foods={frequents ?? []}
                onSelect={onSelect}
                picked={picked}
                onToggle={toggle}
                emptyLabel=""
              />
            ))}

          {tab === 'recipes' &&
            (cookable.length === 0 ? (
              <Empty>
                No recipes yet. Tap <span className="font-semibold text-accent">New recipe</span> at
                the top — paste a link and the whole ingredient list comes across.
              </Empty>
            ) : (
              <Card className="p-0">
                <RecipeRows rows={cookable} onPreview={setPreview} onLog={logRecipe} />
              </Card>
            ))}

          {tab === 'saved' &&
            ((templates ?? []).length === 0 ? (
              <Empty>
                Tap the bookmark next to a meal on Today to save it — then it&rsquo;s one tap here,
                at any multiple. For a dish you cook in batches, make it a recipe instead.
              </Empty>
            ) : (
              <Card className="p-0">
                <ul className="divide-y divide-line">
                  {(templates ?? []).map((template) => (
                    <li key={template.id}>
                      <button
                        onClick={() =>
                          setPreview({
                            title: template.name,
                            subtitle: `${template.items.length} item${
                              template.items.length === 1 ? '' : 's'
                            } · ${template.nutrients.kcal} kcal`,
                            items: template.items.map((item) => ({
                              foodId: item.foodId,
                              label: template.name,
                              grams: item.grams,
                              nutrients: item.nutrients,
                            })),
                            nutrients: template.nutrients,
                            log: (multiple) =>
                              repo.logMealTemplate(template, meal, at, multiple, venue),
                          })
                        }
                        className="w-full px-4 py-2.5 text-left active:bg-sunken"
                      >
                        <div className="truncate text-[14px]">{template.name}</div>
                        <div className="tabular text-[12px] text-ink-muted">
                          {template.nutrients.kcal} kcal · {template.items.length} item
                          {template.items.length === 1 ? '' : 's'}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}

          <button
            onClick={() => onPanel({ kind: 'describe' })}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-sunken py-2.5 text-[13.5px] font-semibold text-accent active:opacity-60"
          >
            <Sparkles size={15} />
            Describe a meal instead
          </button>
        </>
      )}

      {picked.length > 0 && (
        <div className="sticky bottom-0 -mx-3 border-t border-line bg-surface px-3 py-2.5">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPicked([])}
              className="shrink-0 rounded-lg px-2 py-2 text-[13px] text-ink-muted active:bg-sunken"
            >
              Clear
            </button>
            <button
              disabled={isLogging}
              onClick={() => {
                if (isLogging) return
                setIsLogging(true)
                void repo
                  .logFoods(picked, { meal, eatenAt: at, venue })
                  .then(() => onDone())
                  .finally(() => setIsLogging(false))
              }}
              className="min-w-0 flex-1 rounded-xl bg-accent py-2.5 text-[14px] font-semibold text-accent-contrast active:brightness-90"
            >
              {isLogging
                ? 'Logging…'
                : `Log ${picked.length} item${picked.length === 1 ? '' : 's'}`}
            </button>
          </div>
          <p className="mt-1.5 text-center text-[11.5px] text-ink-muted">
            At the amount you last had each — tap a name instead to change it.
          </p>
        </div>
      )}

      {preview && (
        <MealPreviewSheet
          preview={preview}
          meal={meal}
          onDismiss={() => setPreview(null)}
          onLogged={onDone}
        />
      )}
    </div>
  )
}

/**
 * A recommended recipe: the reason it's here, and both ways to act on it.
 *
 * Two targets in one row on purpose. Logging exactly one serving is the overwhelmingly common
 * case and deserves to be a single tap; anything else — half a bowl, two bowls, or just checking
 * what's in it — opens the sheet. Making everyone pass through the sheet to log the ordinary
 * amount is the kind of tax that stops a feature being used.
 */
function RecipeRows({
  rows,
  onPreview,
  onLog,
}: {
  rows: readonly RecipeRecommendation[]
  onPreview: (preview: MealPreview) => void
  onLog: (recipeId: string, servings: number) => Promise<number>
}) {
  return (
    <ul className="divide-y divide-line">
      {rows.map(({ recipe, why }) => {
        const each = perServing(recipe)
        return (
          <li key={recipe.id} className="flex items-center">
            <button
              onClick={() =>
                onPreview({
                  title: recipe.name,
                  subtitle: `${recipe.servings} servings · ${each.kcal} kcal each`,
                  items: [
                    { foodId: null, label: `${recipe.name}, one serving`, grams: 0, nutrients: each },
                  ],
                  nutrients: each,
                  // The multiplier is servings here, which is exactly what it means for a batch
                  // dish: half a portion, or two.
                  log: (multiple) => onLog(recipe.id, multiple),
                })
              }
              className="min-w-0 flex-1 px-4 py-2.5 text-left active:bg-sunken"
            >
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-[14px]">{recipe.name}</span>
                {recipe.cuisine && (
                  <span className="shrink-0 text-[11px] text-ink-muted">
                    {CUISINE_LABELS[recipe.cuisine]}
                  </span>
                )}
              </span>
              <span className="tabular block text-[12px] text-ink-muted">{why}</span>
              <span className="block text-[11px] text-ink-muted">
                Tap for the amount, or &ldquo;Ate 1&rdquo; for one serving
              </span>
            </button>
            {/* Spelled out. An unlabelled "+" beside a recipe reads as "add a recipe", not "I ate
                one serving of this" — and the two are opposite operations. */}
            <button
              onClick={() => void onLog(recipe.id, 1)}
              aria-label={`Log one serving of ${recipe.name}`}
              className="mr-2 shrink-0 rounded-lg bg-accent-wash px-2.5 py-2 text-[12px] font-semibold text-accent active:opacity-60"
            >
              Ate 1
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <Card className="p-4 text-center text-[13px] text-ink-muted">{children}</Card>
}

/** The same time of day, on another date. */
function atOnDay(day: string | undefined): number {
  if (!day) return Date.now()
  const now = new Date()
  const at = Date.parse(`${day}T00:00:00`)
  return Number.isFinite(at)
    ? at + (now.getHours() * 60 + now.getMinutes()) * 60_000
    : Date.now()
}

/** The escape hatch from search: let a sentence be broken into foods. */
function DescribeRow({ text, onOpen }: { text: string; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-2 rounded-2xl bg-accent-wash px-3.5 py-3 text-left active:opacity-70"
    >
      <Sparkles size={16} className="shrink-0 text-accent" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-accent">
          Break down “{text}” as a meal
        </span>
        <span className="block text-[12px] text-ink-muted">
          Into real foods you can correct, with the macros added up
        </span>
      </span>
    </button>
  )
}

function FoodList({
  foods,
  onSelect,
  picked,
  onToggle,
  emptyLabel,
  footer = null,
}: {
  foods: readonly Food[]
  onSelect: (food: Food) => void
  picked: readonly Food[]
  onToggle: (food: Food) => void
  emptyLabel: string
  /** Shown under the rows — a "still searching" line, so results never have to disappear. */
  footer?: React.ReactNode
}) {
  return (
    <Card className="p-0">
      {foods.length === 0 && footer === null ? (
        <p className="px-4 py-6 text-center text-[13.5px] text-ink-muted">{emptyLabel}</p>
      ) : (
        <ul className="divide-y divide-line">
          {foods.map((food) => {
            const isPicked = picked.some((row) => row.id === food.id)
            return (
              <li key={food.id} className="flex items-center">
                {/* The name sets the amount; the tick takes the last one. Two targets because the
                    two jobs are genuinely different, and collapsing them into one costs whichever
                    is less common a whole extra screen. */}
                <button
                  onClick={() => onSelect(food)}
                  className="min-w-0 flex-1 px-4 py-2.5 text-left active:bg-sunken"
                >
                  <div className="truncate text-[14px]">{food.description}</div>
                  <div className="tabular truncate text-[12px] text-ink-muted">
                    {food.brand ? `${food.brand} · ` : ''}
                    {food.per100.kcal} kcal / 100g
                    {food.portions.length > 0 && ` · ${portionWithGrams(food.portions[0]!)}`}
                  </div>
                </button>
                <button
                  onClick={() => onToggle(food)}
                  aria-pressed={isPicked}
                  aria-label={`${isPicked ? 'Remove' : 'Add'} ${food.description}`}
                  className={cn(
                    'mr-2 flex size-9 shrink-0 items-center justify-center rounded-lg border active:opacity-60',
                    isPicked
                      ? 'border-accent bg-accent text-accent-contrast'
                      : 'border-line text-ink-muted',
                  )}
                >
                  {isPicked ? <Check size={16} /> : <Plus size={16} />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {footer !== null && <div className="px-4 pb-2.5">{footer}</div>}
    </Card>
  )
}
