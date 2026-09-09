import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, useToast } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { grams as fmtGrams } from '@/features/shared/format'
import type { EntrySource, MealSlot } from '@/domain/types'
import { totalOf, type EstimatedItem, type MealEstimate } from './estimate'

/**
 * A draft estimate, editable, with the totals it currently implies.
 *
 * Shared by the described-meal and photo paths because they must behave identically: both are
 * guesses about *ingredients*, and both have to be correctable before anything is written. A row
 * that matched nothing counts zero and says so, rather than quietly rounding the total down.
 */
export function EstimateReview({
  estimate,
  meal,
  at,
  source,
  onChange,
  onDone,
}: {
  estimate: MealEstimate
  meal: MealSlot
  at: number
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
          <ItemRow
            key={item.id}
            item={item}
            onGrams={(value) =>
              update(estimate.items.map((i) => (i.id === item.id ? { ...i, grams: value } : i)))
            }
            onRemove={() => update(estimate.items.filter((i) => i.id !== item.id))}
          />
        ))}
      </ul>

      {estimate.items.length === 0 && (
        <p className="text-[13px] text-ink-muted">
          Nothing recognisable came back. Try again, or search for the foods.
        </p>
      )}

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
                meal,
                eatenAt: at,
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

const CONFIDENCE_STYLE: Record<EstimatedItem['confidence'], string> = {
  high: 'text-confidence-high',
  medium: 'text-confidence-medium',
  low: 'text-confidence-low',
}

function ItemRow({
  item,
  onGrams,
  onRemove,
}: {
  item: EstimatedItem
  onGrams: (grams: number) => void
  onRemove: () => void
}) {
  return (
    <li className="flex items-center gap-2 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px]">{item.food?.description ?? item.query}</div>
        <div className="text-[12px] text-ink-muted">
          {item.food === null ? (
            // Said plainly: a row that matched nothing must not look like it counted.
            <span style={{ color: 'var(--status-serious)' }}>
              no match for “{item.query}” — not counted
            </span>
          ) : (
            <>
              <span className={CONFIDENCE_STYLE[item.confidence]}>{item.confidence}</span>
              {item.matchedBy === 'fuzzy' && <span> · loose match</span>}
            </>
          )}
        </div>
      </div>
      <input
        type="number"
        inputMode="numeric"
        value={item.grams}
        onChange={(event) => onGrams(Math.max(0, Number(event.target.value) || 0))}
        aria-label={`Grams of ${item.query}`}
        className="tabular w-16 shrink-0 rounded-lg bg-sunken px-2 py-1.5 text-right text-[13.5px] outline-none"
      />
      <span className="text-[12px] text-ink-muted">g</span>
      <button
        onClick={onRemove}
        aria-label={`Remove ${item.query}`}
        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted active:bg-sunken"
      >
        <Trash2 size={15} />
      </button>
    </li>
  )
}
