import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { cn, formatRelativeDay, formatTimeOfDay } from '@tracker-engine/core'
import {
  Card,
  ScreenHeader,
  SearchField,
  SegmentedTabs,
  type SegmentedTab,
} from '@tracker-engine/ui'
import {
  ChefHat,
  ChevronDown,
  Compass,
  MoreHorizontal,
  PlusCircle,
  ScanLine,
  Utensils,
} from 'lucide-react'
import { isBarcodeScanningAvailable } from '@/platform/barcode'
import * as repo from '@/data/repository'
import { nutrientsFor, perServing } from '@/lib/nutrition'
import { CUISINE_LABELS } from '@/lib/cuisine'
import { matchesQuery, queryTerms } from '@/lib/foodSearch'
import { MEAL_LABELS } from '@/lib/meals'
import { amountGrams } from '@/features/shared/format'
import { MacroNumbers } from '@/features/shared/MacroNumbers'
import { SearchingRow } from '@/features/shared/FoodSearchPicker'
import { useFoodSearch } from '@/features/shared/useFoodSearch'
import { useDebouncedValue } from '@/features/shared/useDebouncedValue'
import type { LastAmount } from '@/data/repository'
import type { Food, MealSlot } from '@/domain/types'
import { AddPanel } from './AddPanel'
import { FitsPanel } from './FitsPanel'
import { DescribeRow, Empty, FoodList, MoreWaysSheet, SavedMeals } from './browseRows'
import { LoggableList } from '@/features/shared/LoggableList'
import { fromLibrary, fromRecent } from '@/features/shared/loggable'
import { DescribePanel } from './DescribePanel'
import { MealTimePicker } from './MealTimePicker'
import { CustomFoodPanel } from './CustomFoodPanel'
import { PhotoPanel } from './PhotoPanel'
import { QuickAddPanel } from './QuickAddPanel'
import { ScanPanel } from './ScanPanel'
import { RecipeEditor } from '@/features/recipes/RecipeEditor'
import type { FoodDraft } from './estimate'
import type { Loggable } from '@/features/shared/loggable'
import type { LogTarget } from '@/features/shared/target'

type Panel =
  | { kind: 'browse' }
  | { kind: 'add'; loggable: Loggable }
  | { kind: 'describe' }
  | { kind: 'scan' }
  | { kind: 'photo' }
  | { kind: 'quick' }
  | { kind: 'custom'; name: string; barcode?: string; draft?: FoodDraft }
  | { kind: 'recipe' }
  | { kind: 'fits' }

/**
 * Three tabs, not four.
 *
 * "Often" was the fourth and it was dead weight. It ranked foods by how many times they'd been
 * logged *on their own* — and once dishes became one row each, someone who eats meals rather than
 * ingredients had nothing in it at all. Everything it did well, Recent already does: it counts
 * repeats ("8×"), it puts starred foods first, and it never takes a fortnight to admit a new staple.
 */
type BrowseTab = 'recent' | 'saved' | 'recipes'

/**
 * Adding food, as a screen rather than a sheet.
 *
 * One input, not a mode switch: the same text either matches foods, your own recipes and saved meals,
 * or gets broken down as a meal — because a person typing "turkey sandwich and an apple" has no way
 * of knowing in advance which of those the app can do. Everything else exists to avoid typing at all.
 *
 * **It opens on what you ate recently.** It used to open on "Suggested" — a computed list of what
 * would fit the calories left — which is the one tab that fails exactly when the screen is most used:
 * `suggestFoods` needs 120 kcal of headroom, and people log most often when the day is nearly full.
 * So the highest-traffic surface in the app opened on an empty card with nothing to tap.
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
   * panel, the count keeps score, and closing is a deliberate act.
   */
  const [added, setAdded] = useState(0)

  /**
   * Home, unless the user says otherwise.
   *
   * It used to be null — "nobody said" — on the grounds that an unrecorded venue is not a fact. True,
   * but it made the honest answer the *rare* one: most meals are eaten at home, so the venue charts
   * filled up with "not recorded" and the question got asked about every meal instead of the
   * interesting ones. The day screen still offers all three on one tap, so correcting it is cheap.
   */
  const target: LogTarget = { meal, at, venue: 'home' }
  const onLogged = (count = 1) => {
    setAdded((current) => current + count)
    setQuery('')
    setPanel({ kind: 'browse' })
  }
  const onEditProduct = (draft: FoodDraft) =>
    setPanel({ kind: 'custom', name: draft.name, draft })

  // The recipe editor owns the whole screen: it has its own header, and a recipe is a different
  // job from logging today's food even though both start at the same "+".
  if (panel.kind === 'recipe') {
    return <RecipeEditor recipeId={null} onBack={() => setPanel({ kind: 'browse' })} />
  }

  return (
    <div className="flex h-full flex-col">
      {/*
        No "Done" button. It called `onClose` — exactly what the back arrow does — so the screen had
        two controls with different words for one action, and the obvious reading of that is that one
        of them commits something. Nothing needs committing: every write has already happened. What
        the button was really for is the count, and that belongs in the title.
      */}
      <ScreenHeader
        title={
          panel.kind !== 'browse'
            ? 'Add food'
            : added > 0
              ? `${added} added to ${MEAL_LABELS[meal].toLowerCase()}`
              : `Add to ${MEAL_LABELS[meal].toLowerCase()}`
        }
        onBack={() => (panel.kind === 'browse' ? onClose() : setPanel({ kind: 'browse' }))}
      />

      <div className="flex-1 overflow-y-auto pb-8">
        {panel.kind === 'browse' && (
          <BrowsePanel
            target={target}
            query={query}
            onQuery={setQuery}
            onMeal={setMeal}
            onAt={setAt}
            onOpen={(loggable) => setPanel({ kind: 'add', loggable })}
            onPanel={setPanel}
            onLogged={onLogged}
          />
        )}
        {panel.kind === 'add' && (
          <AddPanel loggable={panel.loggable} target={target} onDone={onLogged} />
        )}
        {panel.kind === 'fits' && (
          <FitsPanel onOpen={(loggable) => setPanel({ kind: 'add', loggable })} />
        )}
        {panel.kind === 'describe' && (
          <DescribePanel
            target={target}
            initialText={query}
            onDone={onLogged}
            onEdit={onEditProduct}
          />
        )}
        {panel.kind === 'quick' && <QuickAddPanel target={target} onDone={onLogged} />}
        {panel.kind === 'photo' && (
          <PhotoPanel target={target} onDone={onLogged} onEdit={onEditProduct} />
        )}
        {panel.kind === 'custom' && (
          <CustomFoodPanel
            initialName={panel.name}
            initialBarcode={panel.barcode ?? null}
            draft={panel.draft ?? null}
            onSaved={(food) => setPanel({ kind: 'add', loggable: { kind: 'food', food } })}
          />
        )}
        {panel.kind === 'scan' && (
          <ScanPanel
            onFound={(food) => setPanel({ kind: 'add', loggable: { kind: 'food', food } })}
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
  onOpen,
  onPanel,
  onLogged,
}: {
  target: LogTarget
  query: string
  onQuery: (query: string) => void
  onMeal: (meal: MealSlot) => void
  onAt: (at: number) => void
  onOpen: (loggable: Loggable) => void
  onPanel: (panel: Panel) => void
  onLogged: (count: number) => void
}) {
  const { meal, at } = target
  const trimmed = query.trim()
  const isTyping = trimmed.length >= 2
  const [tab, setTab] = useState<BrowseTab>('recent')
  const [isEditingWhen, setIsEditingWhen] = useState(false)
  const [isMoreOpen, setIsMoreOpen] = useState(false)
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
  const settled = useDebouncedValue(trimmed)
  const libraryHits = useLiveQuery(() => repo.searchLibrary(settled), [settled], undefined)
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)
  const savedIds = profile?.favouriteFoodIds ?? []
  /**
   * `undefined` until loaded, not `[]`.
   *
   * A live query given `[]` as its initial value is indistinguishable from one that found nothing, so
   * every list flashed its empty state on open — and on the default tab that meant the first thing
   * anybody saw was "everything you log turns up here", which reads as "you have nothing logged".
   */
  const templates = useLiveQuery(() => repo.mealTemplates(), [], undefined)
  const recipes = useLiveQuery(() => repo.recipes(), [], undefined)
  const recents = useLiveQuery(() => repo.recentItems(), [], undefined)
  const savedFoods = useLiveQuery(
    async () => {
      const found = await repo.foodsByIds(savedIds)
      return savedIds.flatMap((id) => {
        const food = found.get(id)
        return food ? [food] : []
      })
    },
    [savedIds.join(',')],
    undefined,
  )
  // Every ticked food's last amount, in one query rather than one per row, so the confirmation bar
  // can show what it is about to commit instead of describing it.
  const lastAmounts = useLiveQuery(
    () => repo.lastAmountsFor(picked.map((food) => food.id)),
    [picked.map((food) => food.id).join(',')],
    new Map<string, LastAmount>(),
  )

  const canScan = isBarcodeScanningAvailable()
  /**
   * Offered for anything typed, not only for a phrase.
   *
   * It used to need two words, on the theory that one word is a food and several are a dish. But
   * "pizza", "lasagna" and "curry" are the clearest examples of things worth breaking into
   * ingredients, and the rule silently withheld the feature from exactly them.
   */
  const describeRow =
    trimmed.length >= 3 ? (
      <DescribeRow text={trimmed} onOpen={() => onPanel({ kind: 'describe' })} />
    ) : null
  const terms = queryTerms(trimmed)
  const describeLeads =
    !isSearching &&
    (libraryHits ?? []).length === 0 &&
    !results.some((food) => matchesQuery(food, terms))

  const savedCount = (templates ?? []).length + (savedFoods ?? []).length

  const tabs: SegmentedTab<BrowseTab>[] = [
    { key: 'recent', label: 'Recent', badge: (recents ?? []).length || undefined },
    // Deliberately the same word the library uses for the same thing.
    { key: 'saved', label: 'Saved', badge: savedCount || undefined },
    { key: 'recipes', label: 'Recipes', badge: (recipes ?? []).length || undefined },
  ]

  const pickedTotal = picked.reduce((sum, food) => {
    const last = lastAmounts?.get(food.id)
    return sum + nutrientsFor(food, amountGrams(food, last)).kcal
  }, 0)

  return (
    <div className="space-y-3 px-3 py-3">
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
            placeholder="Search a food, a recipe, or a meal"
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
        {/*
          One "more" button instead of a row of unlabelled glyphs. There were three — camera, plus,
          scanner — and the "+" was quick-add, which nobody guesses; meanwhile making a recipe was
          only reachable from a tab you had to stop typing to see, and from Settings. A named list
          costs one tap and makes all five ways in visible at once.
        */}
        <button
          onClick={() => setIsMoreOpen(true)}
          aria-label="More ways to add"
          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-sunken text-ink-secondary active:opacity-60"
        >
          <MoreHorizontal size={20} />
        </button>
      </div>

      {isTyping ? (
        <>
          {describeLeads && describeRow}
          {(libraryHits ?? []).length > 0 && (
            <LoggableList
              heading="Yours"
              items={(libraryHits ?? []).map(fromLibrary)}
              onPick={(hit) => onOpen(hit.loggable)}
            />
          )}
          {/*
            No "Nothing matched." card. When the databases have nothing, the two rows either side of
            this — ask the AI, or create the food — *are* the answer, and a card between them saying
            so only pushed them apart.
          */}
          {(results.length > 0 || isSearching) && (
            <FoodList
              foods={results}
              onSelect={(food) => onOpen({ kind: 'food', food })}
              picked={picked}
              onToggle={toggle}
              saved={savedIds}
              lastAmounts={lastAmounts ?? new Map()}
              emptyLabel=""
              footer={isSearching ? <SearchingRow /> : null}
            />
          )}
          {!describeLeads && describeRow}
          <button
            onClick={() => onPanel({ kind: 'custom', name: trimmed })}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-sunken py-2.5 text-[13.5px] font-semibold text-accent active:opacity-60"
          >
            <PlusCircle size={15} />
            Create “{trimmed}”
          </button>
        </>
      ) : (
        <>
          {/*
            "What fits" as a button, at the top level. It used to be a card buried under the recipes
            tab, which is the last place anybody would look for a *food* suggestion — and it's the
            answer to a question people ask out loud ("what can I still have?"), so it gets a door
            with that question written on it.
          */}
          <button
            onClick={() => onPanel({ kind: 'fits' })}
            className="flex w-full items-center gap-2 rounded-xl bg-accent-wash px-3.5 py-2.5 text-left active:opacity-70"
          >
            <Compass size={16} className="shrink-0 text-accent" />
            <span className="min-w-0 flex-1 text-[13.5px] font-semibold text-accent">
              What can I still have?
            </span>
          </button>

          <SegmentedTabs tabs={tabs} active={tab} onSelect={setTab} />

          {tab === 'recent' &&
            (recents === undefined ? null : recents.length === 0 ? (
              <Empty>Everything you log turns up here.</Empty>
            ) : (
              <LoggableList items={recents.map(fromRecent)} onPick={(row) => onOpen(row.loggable)} />
            ))}

          {/*
            One Saved list, holding both kinds. A bookmarked food and a kept meal were two features
            with two words — "pinned" and "saved" — living in two places, so there was no answering
            the question "where did that go?".
          */}
          {tab === 'saved' &&
            (templates === undefined || savedFoods === undefined ? null : savedCount === 0 ? (
              <Empty>Bookmark a food, or a whole meal from your day, and it lands here.</Empty>
            ) : (
              <>
                {templates.length > 0 && (
                  <SavedMeals
                    templates={templates}
                    onOpen={onOpen}
                    onRemove={(template) => {
                      void repo.deleteMealTemplate(template.id)
                    }}
                  />
                )}
                {savedFoods.length > 0 && (
                  <FoodList
                    foods={savedFoods}
                    onSelect={(food) => onOpen({ kind: 'food', food })}
                    picked={picked}
                    onToggle={toggle}
                    saved={savedIds}
                    lastAmounts={lastAmounts ?? new Map()}
                    emptyLabel=""
                    isRemovable
                  />
                )}
                {/* Said once, at the bottom, because a gesture nobody has met needs introducing
                    exactly as often as that. */}
                <p className="px-1 text-center text-[11.5px] text-ink-muted">
                  Swipe a row to remove it.
                </p>
              </>
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
              {recipes === undefined ? null : recipes.length === 0 ? (
                <Empty>Paste a recipe link and the whole ingredient list comes across.</Empty>
              ) : (
                <Card className="p-0">
                  <ul className="divide-y divide-line">
                    {recipes.map((recipe) => {
                      const each = perServing(recipe)
                      return (
                        <li key={recipe.id}>
                          <button
                            onClick={() => onOpen({ kind: 'recipe', recipe })}
                            className="w-full px-4 py-2.5 text-left active:bg-sunken"
                          >
                            <span className="flex items-baseline gap-2">
                              <span className="min-w-0 flex-1 truncate text-[14px]">
                                {recipe.name}
                              </span>
                              {recipe.cuisine && (
                                <span className="shrink-0 text-[11px] text-ink-muted">
                                  {CUISINE_LABELS[recipe.cuisine]}
                                </span>
                              )}
                            </span>
                            <span className="tabular mt-0.5 flex items-baseline gap-2">
                              <span className="shrink-0 text-[12px] font-semibold">
                                {each.kcal} kcal
                              </span>
                              <MacroNumbers nutrients={each} />
                              <span className="text-[11.5px] text-ink-muted">a serving</span>
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
                  .logFoods(picked, { meal, eatenAt: at, venue: target.venue })
                  .then((count) => {
                    setPicked([])
                    onLogged(count)
                  })
                  .finally(() => setIsLogging(false))
              }}
              className="min-w-0 flex-1 rounded-xl bg-accent py-2.5 text-[14px] font-semibold text-accent-contrast active:brightness-90"
            >
              {isLogging ? 'Logging…' : `Log ${picked.length} · ${Math.round(pickedTotal)} kcal`}
            </button>
          </div>
        </div>
      )}

      {isMoreOpen && (
        <MoreWaysSheet
          onDismiss={() => setIsMoreOpen(false)}
          onPick={(kind) => {
            setIsMoreOpen(false)
            onPanel(kind === 'custom' ? { kind: 'custom', name: '' } : { kind })
          }}
        />
      )}
    </div>
  )
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
