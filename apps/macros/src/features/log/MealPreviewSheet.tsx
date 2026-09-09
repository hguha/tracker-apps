import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { BottomSheet, Button, useToast } from '@tracker-engine/ui'
import { cn } from '@/lib/cn'
import * as repo from '@/data/repository'
import { scale } from '@/lib/nutrition'
import { grams } from '@/features/shared/format'
import { MEAL_LABELS } from '@/features/shared/meals'
import type { Food, MealSlot, Nutrients } from '@/domain/types'

export interface MealPreviewItem {
  /** Null for a quick-add item, which has no food row behind it. */
  foodId: string | null
  label: string
  grams: number
  nutrients: Nutrients
}

export interface MealPreview {
  title: string
  subtitle: string
  items: MealPreviewItem[]
  nutrients: Nutrients
  /** Runs the actual write, at the chosen multiple. */
  log: (multiple: number) => Promise<number>
}

const MULTIPLES = [0.5, 1, 1.5, 2] as const

/**
 * What a saved meal or a repeat actually contains, before it's logged.
 *
 * Tapping "Lunch · 3 items" used to write all three straight into the day, which is a
 * destructive action taken on a label: nobody remembers what a saved meal holds a fortnight
 * later, and the only way to find out was to log it and then delete three rows.
 */
export function MealPreviewSheet({
  preview,
  meal,
  onDismiss,
  onLogged,
}: {
  preview: MealPreview
  meal: MealSlot
  onDismiss: () => void
  onLogged: (count: number) => void
}) {
  const toast = useToast()
  const [multiple, setMultiple] = useState<number>(1)
  const [isSaving, setIsSaving] = useState(false)

  // Names come from the food rows where there are any, so a saved meal doesn't read as
  // "3 items" once its labels are stale.
  const foods = useLiveQuery(
    () => repo.foodsByIds(preview.items.map((item) => item.foodId).filter(isString)),
    [preview],
    new Map<string, Food>(),
  )

  const totals = scale(preview.nutrients, multiple)

  return (
    <BottomSheet onDismiss={onDismiss} panelClassName="flex max-h-[80%] flex-col">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-[16px] font-semibold tracking-tight">{preview.title}</h2>
        <p className="text-[12.5px] text-ink-muted">{preview.subtitle}</p>
      </div>

      <ul className="flex-1 divide-y divide-line overflow-y-auto">
        {preview.items.map((item, index) => (
          <li key={index} className="flex items-baseline gap-2 px-4 py-2">
            <span className="min-w-0 flex-1 truncate text-[13.5px]">
              {(item.foodId ? foods?.get(item.foodId)?.description : null) ?? item.label}
              {item.grams > 0 && (
                <span className="tabular text-ink-muted">
                  {' '}
                  {Math.round(item.grams * multiple)}g
                </span>
              )}
            </span>
            <span className="tabular shrink-0 text-[13px] text-ink-secondary">
              {Math.round(item.nutrients.kcal * multiple)}
            </span>
          </li>
        ))}
      </ul>

      <div className="space-y-3 border-t border-line px-4 py-3">
        <div className="flex gap-1.5">
          {MULTIPLES.map((option) => (
            <button
              key={option}
              onClick={() => setMultiple(option)}
              aria-pressed={option === multiple}
              className={cn(
                'tabular flex-1 rounded-xl py-2 text-[12.5px]',
                option === multiple
                  ? 'bg-accent font-semibold text-accent-contrast'
                  : 'bg-sunken text-ink-secondary',
              )}
            >
              {option === 1 ? '1×' : `${option}×`}
            </button>
          ))}
        </div>

        <p className="tabular text-[13.5px] font-semibold">
          {totals.kcal} kcal · {grams(totals.proteinMg)}P {grams(totals.carbsMg)}C{' '}
          {grams(totals.fatMg)}F
        </p>

        <Button
          className="w-full"
          disabled={isSaving}
          onClick={() => {
            if (isSaving) return
            setIsSaving(true)
            void preview
              .log(multiple)
              .then((count) => {
                toast.show(`Logged ${count} item${count === 1 ? '' : 's'}`)
                onLogged(count)
              })
              .finally(() => setIsSaving(false))
          }}
        >
          {isSaving ? 'Logging…' : `Add to ${MEAL_LABELS[meal].toLowerCase()}`}
        </Button>
      </div>
    </BottomSheet>
  )
}

const isString = (value: string | null): value is string => value !== null
