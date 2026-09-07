import { useState } from 'react'
import { Sparkles, Trash2 } from 'lucide-react'
import { Button, useToast } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { grams as fmtGrams } from '@/features/shared/format'
import type { MealSlot } from '@/domain/types'
import { estimateMeal, totalOf, type EstimatedItem, type MealEstimate } from './estimate'

/**
 * "Turkey sandwich" instead of four separate lookups.
 *
 * The result is a draft, never a log: every row shows what it matched and how confident the
 * breakdown was, and the grams are editable before anything is written. An unmatched row
 * contributes nothing to the totals and says so, rather than quietly guessing.
 */
export function DescribePanel({
  meal,
  at,
  initialText = '',
  onDone,
}: {
  meal: MealSlot
  at: number
  /** Carried over from the search box, so describing a meal never means retyping it. */
  initialText?: string
  onDone: () => void
}) {
  const toast = useToast()
  const [text, setText] = useState(initialText)
  const [estimate, setEstimate] = useState<MealEstimate | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    if (text.trim().length < 3) return
    setIsBusy(true)
    setError(null)
    try {
      setEstimate(await estimateMeal(text))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not work that out.')
    } finally {
      setIsBusy(false)
    }
  }

  function update(items: EstimatedItem[]) {
    setEstimate((current) =>
      current ? { ...current, items, nutrients: totalOf(items) } : current,
    )
  }

  const loggable = (estimate?.items ?? []).filter((i) => i.food !== null && i.grams > 0)

  return (
    <div className="flex max-h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <textarea
          rows={2}
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void run()
            }
          }}
          placeholder="Turkey sandwich and an apple"
          className="w-full resize-none rounded-xl bg-sunken px-3 py-2.5 text-[15px] outline-none"
        />

        <Button className="w-full" disabled={text.trim().length < 3 || isBusy} onClick={() => void run()}>
          <Sparkles size={16} />
          {isBusy ? 'Working it out…' : 'Break it down'}
        </Button>

        {error && (
          <p
            role="alert"
            className="rounded-xl px-3.5 py-2.5 text-[13px]"
            style={{
              background: 'color-mix(in srgb, var(--status-critical) 10%, transparent)',
              color: 'var(--status-critical)',
            }}
          >
            {error}
          </p>
        )}

        {estimate && (
          <>
            <ul className="divide-y divide-line">
              {estimate.items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  onGrams={(value) =>
                    update(
                      estimate.items.map((i) => (i.id === item.id ? { ...i, grams: value } : i)),
                    )
                  }
                  onRemove={() => update(estimate.items.filter((i) => i.id !== item.id))}
                />
              ))}
            </ul>

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
                      source: 'describe',
                      note: item.query,
                      estimate: {
                        confidence: item.confidence,
                        rawLabel: item.query,
                        matchedBy: item.matchedBy,
                      },
                    })
                  }
                  toast.show(`Logged ${loggable.length} items`)
                  onDone()
                })().finally(() => setIsSaving(false))
              }}
            >
              {isSaving ? 'Logging…' : `Log ${loggable.length} item${loggable.length === 1 ? '' : 's'}`}
            </Button>
          </>
        )}
      </div>
    </div>
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
