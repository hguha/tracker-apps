import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button, useToast } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { portionFor } from '@/lib/nutrition'
import { MacroNumbers } from '@/features/shared/MacroNumbers'
import { FoodSearchPicker } from '@/features/shared/FoodSearchPicker'
import { GramsRow } from '@/features/shared/GramsRow'
import type { EntrySource, Food } from '@/domain/types'
import { estimateMeal, totalOf, type EstimatedItem, type MealEstimate } from './estimate'
import type { LogTarget } from './target'

/**
 * A draft estimate, editable, with the totals it currently implies.
 *
 * Shared by the described-meal and photo paths because they must behave identically: both are
 * guesses about *ingredients*, and both have to be correctable before anything is written. A row
 * that matched nothing counts zero and says so, rather than quietly rounding the total down.
 *
 * **It logs as one named dish.** Every row shares a `dishId` and the name the user typed, so the day
 * shows "3 steak tacos" and opens onto the tortilla and the steak — rather than six USDA rows the
 * person never asked for and can't recognise a week later.
 *
 * **Unmatched rows are sorted to the top.** They used to be labelled instead — each row carried
 * "high", "medium", "loose match" — which is the matcher's diagnostics printed at somebody who only
 * wants to know whether the row is right. Ordering acts on the same information without asking the
 * reader to interpret it.
 */
export function EstimateReview({
  estimate,
  target,
  source,
  onChange,
  onDone,
}: {
  estimate: MealEstimate
  target: LogTarget
  source: EntrySource
  onChange: (estimate: MealEstimate) => void
  onDone: () => void
}) {
  const toast = useToast()
  const [isSaving, setIsSaving] = useState(false)
  const [name, setName] = useState(estimate.label)

  const update = (items: EstimatedItem[]) =>
    onChange({ ...estimate, items, nutrients: totalOf(items) })
  const loggable = estimate.items.filter((item) => item.food !== null && item.grams > 0)
  const unmatched = estimate.items.filter((item) => item.food === null)
  const ordered = [...unmatched, ...estimate.items.filter((item) => item.food !== null)]

  return (
    <>
      {/*
        The name is a field, not a caption: the model's parse of "chocolate zucchini muffins" can be
        two odd-sounding foods, and the one thing the user is certain about is what they ate.
      */}
      <label className="block">
        <span className="text-[11px] text-ink-muted">Call this</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="What you ate"
          className="mt-0.5 w-full rounded-xl bg-sunken px-3 py-2 text-[15px] font-medium outline-none"
        />
      </label>

      {unmatched.length > 0 && (
        <p className="text-[12.5px]" style={{ color: 'var(--status-serious)' }}>
          {unmatched.length} of these didn&rsquo;t match a food, so {unmatched.length === 1 ? 'it counts' : 'they count'} nothing.
          Pick a match below, or remove {unmatched.length === 1 ? 'it' : 'them'}.
        </p>
      )}

      <ul className="divide-y divide-line">
        {ordered.map((item) => (
          <GramsRow
            key={item.id}
            title={item.food?.description ?? item.query}
            subtitle={<ItemNote item={item} />}
            grams={item.grams}
            onGrams={(value) =>
              update(estimate.items.map((i) => (i.id === item.id ? { ...i, grams: value } : i)))
            }
            onRemove={() => update(estimate.items.filter((i) => i.id !== item.id))}
          />
        ))}
      </ul>

      {estimate.items.length === 0 && (
        <p className="text-[13px] text-ink-muted">
          Nothing recognisable came back. Add the parts yourself below, or search for them.
        </p>
      )}

      <AddToDraft
        onAdd={(added) => update([...estimate.items, ...added])}
        nextIndex={estimate.items.length}
      />

      <p className="tabular flex items-baseline gap-2 text-[13.5px]">
        <span className="font-semibold">{estimate.nutrients.kcal} kcal</span>
        <MacroNumbers nutrients={estimate.nutrients} />
        <span className="text-[12px] text-ink-muted">
          all {estimate.items.length} item{estimate.items.length === 1 ? '' : 's'}
        </span>
      </p>
      {estimate.assumptions && (
        <p className="text-[12.5px] text-ink-secondary">{estimate.assumptions}</p>
      )}

      <Button
        className="w-full"
        disabled={loggable.length === 0 || isSaving}
        onClick={() => {
          if (isSaving) return
          setIsSaving(true)
          void (async () => {
            const label = name.trim()
            // One dish per write, but only when there is more than one row to hold together: a
            // single food is a single food, and wrapping it in a dish would add a layer to open.
            const dishId = loggable.length > 1 ? repo.newDishId() : null
            for (const item of loggable) {
              await repo.logFood({
                food: item.food!,
                grams: item.grams,
                meal: target.meal,
                eatenAt: target.at,
                venue: target.venue,
                source,
                note: item.query,
                dishId,
                dishName: dishId === null ? null : label || 'Meal',
                estimate: {
                  confidence: item.confidence,
                  rawLabel: item.query,
                  matchedBy: item.matchedBy,
                },
              })
            }
            toast.show(dishId === null ? 'Logged' : `${label || 'Meal'} logged`)
            onDone()
          })().finally(() => setIsSaving(false))
        }}
      >
        {isSaving ? 'Logging…' : `Log ${name.trim() || 'this'}`}
      </Button>
    </>
  )
}

/**
 * Adding what the breakdown missed, without leaving the draft.
 *
 * The alternative was logging the six items it did find and then searching for the noodles as a
 * separate entry — which works, but splits one meal into two and makes the user do the assembly.
 * One box, two ways out of the same problem: pick a food, or ask for the thing by name and let it
 * be broken down too, exactly as on the main log screen.
 */
export function AddToDraft({
  onAdd,
  nextIndex,
  placeholder = 'Something missing? Add it here',
}: {
  onAdd: (items: EstimatedItem[]) => void
  nextIndex: number
  placeholder?: string
}) {
  const [breakingDown, setBreakingDown] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function addFood(food: Food) {
    const portion = portionFor(food, null)
    onAdd([
      {
        id: `est-added-${nextIndex}-${food.id}`,
        query: food.description,
        // A portion if the food has one, else 100 g — a figure the user can see and correct.
        grams: portion ? Math.round(portion.grams) : 100,
        confidence: 'high',
        food,
        matchedBy: 'exact',
      },
    ])
  }

  /**
   * For a *dish*, not an ingredient: "chicken tikka masala" is several foods, and asking for it by
   * name is the only way to get all of them at once.
   */
  async function breakDown(query: string) {
    if (query.length < 3 || breakingDown !== null) return
    setBreakingDown(query)
    setError(null)
    try {
      const extra = await estimateMeal(query)
      onAdd(
        extra.items.map((item, index) => ({ ...item, id: `est-asked-${nextIndex}-${index}` })),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not work that out.')
    } finally {
      setBreakingDown(null)
    }
  }

  return (
    <div className="rounded-xl bg-sunken/60 p-2.5">
      <FoodSearchPicker placeholder={placeholder} branded={false} onPick={addFood}>
        {(query) => (
          <>
            {/*
              Offered only for something that reads as a dish rather than an ingredient. The first
              version offered "Ask for X instead" under every query, so searching for "refried
              beans" — one food, which the database has — invited the user to have a language model
              guess at it instead. That isn't an alternative way to find a food; it's a different
              operation, and labelling it as a fallback made it look like the search had given up.
            */}
            {query.split(/\s+/).length >= 2 && (
              <button
                onClick={() => void breakDown(query)}
                disabled={breakingDown !== null}
                className="mt-1 flex w-full items-center gap-1.5 rounded-lg px-1 py-2 text-left text-[12.5px] text-ink-muted active:opacity-60"
              >
                <Sparkles size={13} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1">
                  {breakingDown === query ? (
                    'Working it out…'
                  ) : (
                    <>
                      Is <span className="font-semibold text-accent">{query}</span> a whole dish?
                      Break it into its parts
                    </>
                  )}
                </span>
              </button>
            )}
          </>
        )}
      </FoodSearchPicker>

      {error && (
        <p role="alert" className="mt-1 text-[12.5px]" style={{ color: 'var(--status-critical)' }}>
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * What a row contributes, or that it contributes nothing.
 *
 * The macros, not the match quality. This used to print `confidence` and `matchedBy: 'fuzzy'` — the
 * matcher's own vocabulary — under every row, which answers a question the user never asked while
 * leaving the one they did ask ("how much protein was in that?") unanswered.
 */
function ItemNote({ item }: { item: EstimatedItem }) {
  if (item.food === null) {
    return (
      <span style={{ color: 'var(--status-serious)' }}>
        no match for “{item.query}” — pick one below
      </span>
    )
  }
  return (
    <span className="tabular flex items-baseline gap-2">
      <span className="text-ink-secondary">{nutrientsOf(item).kcal} kcal</span>
      <MacroNumbers nutrients={nutrientsOf(item)} />
    </span>
  )
}

const nutrientsOf = (item: EstimatedItem) => totalOf([item])
