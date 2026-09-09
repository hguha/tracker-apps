import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button, useToast } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { portionFor } from '@/lib/nutrition'
import { grams as fmtGrams } from '@/features/shared/format'
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

  const update = (items: EstimatedItem[]) =>
    onChange({ ...estimate, items, nutrients: totalOf(items) })
  const loggable = estimate.items.filter((item) => item.food !== null && item.grams > 0)

  return (
    <>
      <ul className="divide-y divide-line">
        {estimate.items.map((item) => (
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

      <p className="tabular text-[13.5px] font-semibold">
        {estimate.nutrients.kcal} kcal · {fmtGrams(estimate.nutrients.proteinMg)}P{' '}
        {fmtGrams(estimate.nutrients.carbsMg)}C {fmtGrams(estimate.nutrients.fatMg)}F
      </p>
      {estimate.assumptions && (
        <p className="text-[12.5px] text-ink-muted">{estimate.assumptions}</p>
      )}

      <Button
        className="w-full"
        disabled={loggable.length === 0 || isSaving}
        onClick={() => {
          if (isSaving) return
          setIsSaving(true)
          void (async () => {
            for (const item of loggable) {
              await repo.logFood({
                food: item.food!,
                grams: item.grams,
                meal: target.meal,
                eatenAt: target.at,
                venue: target.venue,
                source,
                note: item.query,
                estimate: {
                  confidence: item.confidence,
                  rawLabel: item.query,
                  matchedBy: item.matchedBy,
                },
              })
            }
            toast.show(`Logged ${loggable.length} item${loggable.length === 1 ? '' : 's'}`)
            onDone()
          })().finally(() => setIsSaving(false))
        }}
      >
        {isSaving
          ? 'Logging…'
          : `Log ${loggable.length} item${loggable.length === 1 ? '' : 's'}`}
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
  const [isAsking, setIsAsking] = useState(false)
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

  async function ask(query: string) {
    if (query.length < 3 || isAsking) return
    setIsAsking(true)
    setError(null)
    try {
      const extra = await estimateMeal(query)
      onAdd(
        extra.items.map((item, index) => ({ ...item, id: `est-asked-${nextIndex}-${index}` })),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not work that out.')
    } finally {
      setIsAsking(false)
    }
  }

  return (
    <div className="rounded-xl bg-sunken/60 p-2.5">
      <FoodSearchPicker placeholder={placeholder} branded={false} onPick={addFood}>
        {(query) => (
          <button
            onClick={() => void ask(query)}
            disabled={isAsking}
            className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-[13px] font-semibold text-accent active:opacity-60"
          >
            <Sparkles size={14} />
            {isAsking ? 'Working it out…' : `Ask for “${query}” instead`}
          </button>
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

const CONFIDENCE_STYLE: Record<EstimatedItem['confidence'], string> = {
  high: 'text-confidence-high',
  medium: 'text-confidence-medium',
  low: 'text-confidence-low',
}

/** How well a row matched, or — said plainly — that it didn't and therefore counted nothing. */
function ItemNote({ item }: { item: EstimatedItem }) {
  if (item.food === null) {
    return (
      <span style={{ color: 'var(--status-serious)' }}>
        no match for “{item.query}” — not counted
      </span>
    )
  }
  return (
    <span className="text-ink-muted">
      <span className={CONFIDENCE_STYLE[item.confidence]}>{item.confidence}</span>
      {item.matchedBy === 'fuzzy' && <span> · loose match</span>}
    </span>
  )
}
