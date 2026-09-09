import { useState } from 'react'
import { Button, useToast } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { nutrientsFor, portionFor } from '@/lib/nutrition'
import { grams, portionLabel } from '@/features/shared/format'
import type { Food, MealSlot } from '@/domain/types'

/**
 * How much of it, then log.
 *
 * `isSaving` is not decoration: without it a second tap while the first write is in flight
 * logs the food twice, which is how three copies of a scanned barcode ended up in one day.
 */
export function PortionPanel({
  food,
  meal,
  at,
  onDone,
}: {
  food: Food
  meal: MealSlot
  at: number
  onDone: () => void
}) {
  const toast = useToast()
  const defaultPortion = portionFor(food, null)
  const [portionId, setPortionId] = useState<string | null>(defaultPortion?.id ?? null)
  const [count, setCount] = useState('1')
  // A food with no portions (most branded rows, and any own food without a stated serving) would
  // otherwise open with an empty grams box and a disabled button — a dead end on the last step.
  const [gramsInput, setGramsInput] = useState(defaultPortion ? '' : '100')
  const [isSaving, setIsSaving] = useState(false)

  const portion = portionFor(food, portionId)
  const resolvedGrams = gramsInput
    ? Number(gramsInput)
    : portion
      ? portion.grams * (Number(count) || 0)
      : 0
  const preview = nutrientsFor(food, resolvedGrams || 0)

  async function log() {
    if (isSaving || resolvedGrams <= 0) return
    setIsSaving(true)
    try {
      await repo.logFood({
        food,
        meal,
        eatenAt: at,
        source: food.barcode ? 'barcode' : 'search',
        ...(gramsInput
          ? { grams: Number(gramsInput) }
          : { portionId, portionCount: Number(count) }),
      })
      toast.show(`Logged ${food.description}`)
      onDone()
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-3 px-4 py-3">
      <div>
        <h2 className="text-[16px] font-semibold tracking-tight">{food.description}</h2>
        {food.brand && <p className="text-[12.5px] text-ink-muted">{food.brand}</p>}
      </div>

      {food.portions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {food.portions.map((option) => (
            <button
              key={option.id}
              onClick={() => {
                setPortionId(option.id)
                setGramsInput('')
              }}
              className={
                option.id === portionId && !gramsInput
                  ? 'rounded-full bg-accent px-3 py-1.5 text-[13px] font-semibold text-accent-contrast'
                  : 'rounded-full bg-sunken px-3 py-1.5 text-[13px] text-ink-secondary'
              }
            >
              {portionLabel(option)}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <label className="flex-1">
          <span className="text-[12px] text-ink-muted">Servings</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.25"
            value={count}
            onChange={(event) => {
              setCount(event.target.value)
              setGramsInput('')
            }}
            className="mt-0.5 w-full rounded-xl bg-sunken px-3 py-2 text-[15px] outline-none"
          />
        </label>
        <label className="flex-1">
          <span className="text-[12px] text-ink-muted">or grams</span>
          <input
            type="number"
            inputMode="numeric"
            value={gramsInput}
            onChange={(event) => setGramsInput(event.target.value)}
            placeholder={resolvedGrams ? String(Math.round(resolvedGrams)) : ''}
            className="mt-0.5 w-full rounded-xl bg-sunken px-3 py-2 text-[15px] outline-none"
          />
        </label>
      </div>

      <p className="tabular text-[13px] text-ink-secondary">
        {preview.kcal} kcal · {grams(preview.proteinMg)}P {grams(preview.carbsMg)}C{' '}
        {grams(preview.fatMg)}F
      </p>

      <Button className="w-full" disabled={resolvedGrams <= 0 || isSaving} onClick={() => void log()}>
        {isSaving ? 'Logging…' : 'Log it'}
      </Button>
    </div>
  )
}
