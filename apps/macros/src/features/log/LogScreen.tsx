import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { dayKey, formatRelativeDay, formatTimeOfDay } from '@tracker-engine/core'
import {
  Card,
  ScreenHeader,
  SearchField,
  SegmentedTabs,
  type SegmentedTab,
} from '@tracker-engine/ui'
import {
  Camera,
  Check,
  ChefHat,
  ChevronDown,
  Plus,
  PlusCircle,
  ScanLine,
  Sparkles,
  Star,
  Utensils,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { isBarcodeScanningAvailable } from '@/platform/barcode'
import * as repo from '@/data/repository'
import { dayTotals, nutrientsFor, perServing, portionFor, remaining } from '@/lib/nutrition'
import { suggestFoods } from '@/lib/suggest'
import { recommendRecipes, type RecipeRecommendation } from '@/lib/recommend'
import { CUISINE_LABELS } from '@/lib/cuisine'
import { portionLabel, portionWithGrams } from '@/features/shared/format'
import { MEAL_LABELS } from '@/lib/meals'
import { MacroNumbers } from '@/features/shared/MacroNumbers'
import { SearchingRow } from '@/features/shared/FoodSearchPicker'
import { useFoodSearch } from '@/features/shared/useFoodSearch'
import type { LastAmount, RecentItem } from '@/data/repository'
import type { Food, MealSlot } from '@/domain/types'
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

type BrowseTab = 'recent' | 'often' | 'recipes' | 'saved'

/**
 * Adding food, as a screen rather than a sheet.
 *
 * One input, not a mode switch: the same text either matches foods or gets broken down as a
 * meal, because a person typing "turkey sandwich and an apple" has no way of knowing in advance
 * which of those the app can do. Everything else exists to avoid typing at all.
 *
 * **It opens on what you ate recently.** It used to open on "Suggested" — a computed list of what
 * would fit the calories left — which is the one tab that fails exactly when the screen is most used:
 * `suggestFoods` needs 120 kcal of headroom, and people log most often when the day is nearly full.
 * So the highest-traffic surface in the app opened on an empty card with nothing to tap. Recent is
 * both the answer to the commonest question ("the yoghurt I have every morning") and never empty
 * after the first day.
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
  const [query, setQuery] = useState('')
  const [panel, setPanel] = useState<Panel>({ kind: 'browse' })
  /**
   * How much has been added since this screen opened.
   *
   * The screen used to close on every single write, so logging a five-item breakfast meant opening
   * it five times and retyping the meal and the time each round. Now a write returns to the browse
   * panel, the count keeps score, and closing is a deliberate act — which is how MyFitnessPal's
   * diary works and why adding a whole meal there doesn't feel like five separate tasks.
   */
  const [added, setAdded] = useState(0)

  // Venue is deliberately absent: it's asked on the finished meal, where the answer is known and one
  // tap covers every row. See `features/shared/VenueChoice`.
  const target: LogTarget = { meal, at, venue: null }
  const onLogged = (count = 1) => {
    setAdded((current) => current + count)
    setQuery('')
    setPanel({ kind: 'browse' })
  }

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
          // Done, once anything has been added — so leaving is a choice rather than a side effect
          // of having logged something.
          added > 0 ? (
            <button
              onClick={onClose}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-semibold text-accent-contrast active:brightness-90"
            >
              <Check size={15} />
              Done · {added}
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
            onSelect={(food) => setPanel({ kind: 'portion', food })}
            onPanel={setPanel}
            added={added}
            onDone={onLogged}
          />
        )}
        {panel.kind === 'portion' && (
          <PortionPanel food={panel.food} target={target} onDone={onLogged} />
        )}
        {panel.kind === 'describe' && (
          <DescribePanel target={target} initialText={query} onDone={onLogged} />
        )}
        {panel.kind === 'quick' && <QuickAddPanel target={target} onDone={onLogged} />}
        {panel.kind === 'photo' && <PhotoPanel target={target} onDone={onLogged} />}
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
  onSelect,
  onPanel,
  added,
  onDone,
}: {
  target: LogTarget
  query: string
  onQuery: (query: string) => void
  onMeal: (meal: MealSlot) => void
  onAt: (at: number) => void
  onSelect: (food: Food) => void
  onPanel: (panel: Panel) => void
  added: number
  onDone: (count?: number) => void
}) {
  const { meal, at } = target
  const trimmed = query.trim()
  const isTyping = trimmed.length >= 2
  const [tab, setTab] = useState<BrowseTab>('recent')
  const [preview, setPreview] = useState<MealPreview | null>(null)
  const [isEditingWhen, setIsEditingWhen] = useState(false)
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
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)
  const favouriteIds = profile?.favouriteFoodIds ?? []
  const frequents = useLiveQuery(
    async () => {
      // Starred first, in the order they were starred, then the rest by how often they're logged.
      // Frequency alone takes a fortnight to admit a new staple and never forgets an old one.
      const ids = [...favouriteIds, ...(frequentIds ?? []).filter((id) => !favouriteIds.includes(id))]
      const found = await repo.foodsByIds(ids)
      return ids.flatMap((id) => {
        const food = found.get(id)
        return food ? [food] : []
      })
    },
    [frequentIds, favouriteIds.join(',')],
    [],
  )
  const templates = useLiveQuery(() => repo.mealTemplates(), [], [])
  const recipes = useLiveQuery(() => repo.recipes(), [], [])
  const usage = useLiveQuery(() => repo.recipeUsage(), [], new Map())
  const recentCuisines = useLiveQuery(() => repo.recentRecipeCuisines(), [], [])
  const recents = useLiveQuery(() => repo.recentItems(), [], [])
  const targets = useLiveQuery(() => repo.currentTargets(), [], null)
  const today = dayKey(Date.now())
  const todayEntries = useLiveQuery(() => repo.entriesForDay(today), [today], [])
  // Every ticked food's last amount, in one query rather than one per row, so the confirmation bar
  // can show what it is about to commit instead of describing it.
  const lastAmounts = useLiveQuery(
    () => repo.lastAmountsFor(picked.map((food) => food.id)),
    [picked.map((food) => food.id).join(',')],
    new Map<string, LastAmount>(),
  )

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

  /**
   * Logging a recipe writes its ingredients, always.
   *
   * There used to be two shapes for one intent: the recipe screen wrote one row per ingredient, and
   * this screen wrote a single opaque row — same dish, two completely different diaries, and no way
   * for the user to know which they were about to get. Ingredients are the right shape because they
   * carry the micronutrients and can be corrected individually; a shared `dishId` is what keeps them
   * reading as one line.
   */
  const logRecipe = (recipeId: string, servings: number) => {
    const recipe = (recipes ?? []).find((row) => row.id === recipeId)
    if (!recipe) return Promise.resolve(0)
    // A cooked recipe is eaten at home whatever else is unset — see logRecipeIngredients.
    return repo.logRecipeIngredients(recipe, servings, meal, at)
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
    { key: 'recent', label: 'Recent', badge: (recents ?? []).length || undefined },
    { key: 'often', label: 'Often', badge: (frequents ?? []).length || undefined },
    { key: 'recipes', label: 'Recipes', badge: (recipes ?? []).length || undefined },
    // Deliberately the same word the library uses for the same thing.
    { key: 'saved', label: 'Saved', badge: (templates ?? []).length || undefined },
  ]

  const pickedTotal = picked.reduce((sum, food) => {
    const last = lastAmounts?.get(food.id)
    const grams = amountGrams(food, last)
    return sum + nutrientsFor(food, grams).kcal
  }, 0)

  return (
    <div className="space-y-3 px-3 py-3">
      {added > 0 && (
        <p className="rounded-xl bg-accent-wash px-3 py-2 text-[12.5px] text-accent">
          {added} item{added === 1 ? '' : 's'} added. Keep going, or tap{' '}
          <span className="font-semibold">Done</span> when you&rsquo;ve finished this meal.
        </p>
      )}

      {/*
        Meal and time as one line you can tap, not a card that owns the top third of the screen.
        Both are already right on almost every log — `mealForHour` and now — and both are correctable
        afterwards on the day screen, so paying for them on every write served the rare case at the
        expense of the common one.
      */}
      <div>
        <button
          onClick={() => setIsEditingWhen((current) => !current)}
          aria-expanded={isEditingWhen}
          className="flex w-full items-center gap-1.5 rounded-xl bg-sunken px-3 py-2 text-left text-[13px] active:opacity-60"
        >
          <Utensils size={13} className="shrink-0 text-ink-muted" />
          <span className="font-medium">{MEAL_LABELS[meal]}</span>
          <span className="tabular min-w-0 flex-1 truncate text-ink-muted">
            · {formatRelativeDay(at)} {formatTimeOfDay(at)}
          </span>
          <ChevronDown
            size={15}
            className={cn('shrink-0 text-ink-muted transition-transform', isEditingWhen && 'rotate-180')}
          />
        </button>
        {isEditingWhen && (
          <Card className="mt-2 p-3">
            <MealTimePicker meal={meal} at={at} onMeal={onMeal} onAt={onAt} />
          </Card>
        )}
      </div>

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
          aria-label="Add calories and macros directly"
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
            favourites={favouriteIds}
            lastAmounts={lastAmounts ?? new Map()}
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

          {tab === 'recent' &&
            ((recents ?? []).length === 0 ? (
              <Empty>
                Everything you log turns up here, newest first — so the second time you eat something
                it&rsquo;s one tap.
              </Empty>
            ) : (
              <RecentList
                items={recents ?? []}
                onSelect={onSelect}
                onLogDish={(item) =>
                  repo.logDishAgain(item.dishId, { meal, at }).then((count) => onDone(count))
                }
              />
            ))}

          {tab === 'often' &&
            ((frequents ?? []).length === 0 ? (
              <Empty>
                Foods you log more than once collect here. Tap the star on any food to pin it to the
                top of this list.
              </Empty>
            ) : (
              <FoodList
                foods={frequents ?? []}
                onSelect={onSelect}
                picked={picked}
                onToggle={toggle}
                favourites={favouriteIds}
                lastAmounts={lastAmounts ?? new Map()}
                emptyLabel=""
              />
            ))}

          {tab === 'recipes' && (
            <>
              <button
                onClick={() => onPanel({ kind: 'recipe' })}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-sunken py-2.5 text-[13.5px] font-semibold text-accent active:opacity-60"
              >
                <ChefHat size={15} />
                New recipe
              </button>
              {cookable.length === 0 ? (
                <Empty>
                  No recipes yet. Paste a link into a new recipe and the whole ingredient list comes
                  across.
                </Empty>
              ) : (
                <Card className="p-0">
                  <RecipeRows rows={cookable} onPreview={setPreview} onLog={logRecipe} />
                </Card>
              )}
              {/*
                Single-food suggestions, under the recipes rather than as the screen's own opening
                tab: it is a useful answer to "what fits", and a terrible answer to "log my yoghurt".
              */}
              {suggestions.length > 0 && (
                <Card className="p-0">
                  <h2 className="px-4 pb-1 pt-3 text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
                    Fits what&rsquo;s left today
                  </h2>
                  <ul className="divide-y divide-line">
                    {suggestions.map((suggestion) => (
                      <li key={suggestion.food.id}>
                        <button
                          onClick={() => onSelect(suggestion.food)}
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
            </>
          )}

          {tab === 'saved' &&
            ((templates ?? []).length === 0 ? (
              <Empty>
                Tap the bookmark on a meal in your day to save it — then it&rsquo;s one tap here, at
                any multiple. For a dish you cook in batches, make it a recipe instead.
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
                            log: (multiple) => repo.logMealTemplate(template, meal, at, multiple),
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
                  .logFoods(picked, { meal, eatenAt: at, venue: null })
                  .then((count) => {
                    setPicked([])
                    onDone(count)
                  })
                  .finally(() => setIsLogging(false))
              }}
              className="min-w-0 flex-1 rounded-xl bg-accent py-2.5 text-[14px] font-semibold text-accent-contrast active:brightness-90"
            >
              {isLogging
                ? 'Logging…'
                : `Log ${picked.length} · ${Math.round(pickedTotal)} kcal`}
            </button>
          </div>
        </div>
      )}

      {preview && (
        <MealPreviewSheet
          preview={preview}
          meal={meal}
          onDismiss={() => setPreview(null)}
          onLogged={(count) => {
            setPreview(null)
            onDone(count)
          }}
        />
      )}
    </div>
  )
}

/**
 * What you have eaten lately: dishes and foods in one list, newest first.
 *
 * A dish is one row with the name you gave it and the foods it contains as a subtitle, so "3 steak
 * tacos" is recognisable and re-loggable in a tap. This replaced a list of `day|meal` groups labelled
 * "Lunch · Tuesday", which named no food at all and grew a new row every time you ate the same lunch.
 */
function RecentList({
  items,
  onSelect,
  onLogDish,
}: {
  items: readonly RecentItem[]
  onSelect: (food: Food) => void
  onLogDish: (item: Extract<RecentItem, { kind: 'dish' }>) => Promise<unknown>
}) {
  const [busy, setBusy] = useState<string | null>(null)

  return (
    <Card className="p-0">
      <ul className="divide-y divide-line">
        {items.map((item) =>
          item.kind === 'food' ? (
            <li key={`f:${item.food.id}`}>
              <button
                onClick={() => onSelect(item.food)}
                className="w-full px-4 py-2.5 text-left active:bg-sunken"
              >
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-[14px]">
                    {item.food.description}
                  </span>
                  <Times times={item.times} />
                </div>
                <div className="tabular truncate text-[12px] text-ink-muted">
                  {describeAmount(item.food, item.amount)}
                  {item.food.brand ? ` · ${item.food.brand}` : ''}
                </div>
              </button>
            </li>
          ) : (
            <li key={`d:${item.dishId}`} className="flex items-center">
              <span className="min-w-0 flex-1 px-4 py-2.5">
                <span className="flex items-baseline gap-2">
                  <Utensils size={13} className="shrink-0 translate-y-px text-ink-muted" />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
                    {item.name}
                  </span>
                  <Times times={item.times} />
                </span>
                <span className="mt-0.5 flex items-baseline gap-2 pl-[21px]">
                  <span className="tabular shrink-0 text-[12px] font-semibold">
                    {item.nutrients.kcal} kcal
                  </span>
                  <MacroNumbers nutrients={item.nutrients} />
                </span>
                <span className="block truncate pl-[21px] text-[11.5px] text-ink-muted">
                  {item.parts.join(', ')}
                </span>
              </span>
              <button
                disabled={busy === item.dishId}
                onClick={() => {
                  setBusy(item.dishId)
                  void onLogDish(item).finally(() => setBusy(null))
                }}
                className="mr-2 shrink-0 rounded-lg bg-accent-wash px-2.5 py-2 text-[12px] font-semibold text-accent active:opacity-60"
              >
                {busy === item.dishId ? '…' : 'Log'}
              </button>
            </li>
          ),
        )}
      </ul>
    </Card>
  )
}

/** How many times this has been eaten in the window — only worth saying past once. */
function Times({ times }: { times: number }) {
  if (times < 2) return null
  return <span className="tabular shrink-0 text-[11.5px] text-ink-muted">{times}×</span>
}

/**
 * A recommended recipe: why it's here, and one target that opens it.
 *
 * There used to be a "Log 1" button beside the name. Two targets on one row means guessing which half
 * you hit, and the recipe screen already shows the servings control the moment you arrive — so a tap
 * on the row now leads somewhere that tells you what you're about to log before it logs it.
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
          <li key={recipe.id}>
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
                <span className="tabular shrink-0 text-[12px] font-semibold">{each.kcal} kcal</span>
                <MacroNumbers nutrients={each} />
              </span>
              <span className="tabular block text-[11.5px] text-ink-muted">{why}</span>
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
          Into real foods you can correct, kept together as one dish
        </span>
      </span>
    </button>
  )
}

/** The grams a tick will log — the last amount, or the food's own portion, or 100 g. */
function amountGrams(food: Food, last: LastAmount | null | undefined): number {
  if (last && last.grams > 0) return last.grams
  const portion = portionFor(food, null)
  return portion ? portion.grams : 100
}

function describeAmount(food: Food, last: LastAmount | null | undefined): string {
  const grams = amountGrams(food, last)
  const portion = last?.portionId ? portionFor(food, last.portionId) : null
  const count = last?.portionCount ?? 1
  const amount = portion
    ? `${count} × ${portionLabel(portion)} · ${Math.round(grams)} g`
    : `${Math.round(grams)} g`
  return `${amount} · ${nutrientsFor(food, grams).kcal} kcal`
}

function FoodList({
  foods,
  onSelect,
  picked,
  onToggle,
  favourites,
  lastAmounts,
  emptyLabel,
  footer = null,
}: {
  foods: readonly Food[]
  onSelect: (food: Food) => void
  picked: readonly Food[]
  onToggle: (food: Food) => void
  favourites: readonly string[]
  /** Only populated for ticked foods, which is the only place the number is committed blind. */
  lastAmounts: ReadonlyMap<string, LastAmount>
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
                    {/*
                      Once ticked, the row states the amount about to be logged. The confirmation bar
                      used to describe it instead — "at the amount you last had each" — so a one-off
                      300 g portion was silently repeated with nothing on screen to catch it.
                    */}
                    {isPicked ? (
                      <span className="text-accent">{describeAmount(food, lastAmounts.get(food.id))}</span>
                    ) : (
                      <>
                        {food.brand ? `${food.brand} · ` : ''}
                        {food.per100.kcal} kcal / 100g
                        {food.portions.length > 0 && ` · ${portionWithGrams(food.portions[0]!)}`}
                      </>
                    )}
                  </div>
                </button>
                <button
                  onClick={() => void repo.toggleFavourite(food.id)}
                  aria-pressed={favourites.includes(food.id)}
                  aria-label={`${favourites.includes(food.id) ? 'Unpin' : 'Pin'} ${food.description}`}
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-muted active:opacity-60"
                >
                  <Star
                    size={16}
                    className={favourites.includes(food.id) ? 'fill-accent text-accent' : ''}
                  />
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
