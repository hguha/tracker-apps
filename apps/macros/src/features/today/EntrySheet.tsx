import { useState } from 'react'
import { BottomSheet, Button } from '@tracker-engine/ui'
import { Trash2 } from 'lucide-react'
import * as repo from '@/data/repository'
import { MacroNumbers } from '@/features/shared/MacroNumbers'
import { MealTimePicker } from '@/features/log/MealTimePicker'
import type { LogEntry, MealSlot } from '@/domain/types'

/**
 * Moving something already logged to another meal or time.
 *
 * Deliberately *only* that. It used to also hold a grams field and a delete button, both of which
 * already exist on the row that opens it — and with a different commit model, since the row writes on
 * every tap and the sheet batched into a Save. Two editors for one field is how a screen ends up
 * needing to explain itself; the amount belongs on the row, where the correction is one tap.
 *
 * The time matters more than it looks: a batch logged at 9pm would otherwise claim breakfast happened
 * then, which is the fastest way to make every timing figure in the app wrong.
 */
export function EntrySheet({
  entry,
  name,
  siblings,
  onDismiss,
}: {
  entry: LogEntry
  name: string
  /** Every row in the same meal, so moving a dish moves the dish rather than one of its parts. */
  siblings: readonly LogEntry[]
  onDismiss: () => void
}) {
  const [meal, setMeal] = useState<MealSlot>(entry.meal)
  const [at, setAt] = useState(entry.eatenAt)
  const [isSaving, setIsSaving] = useState(false)

  // A dish moves as a whole: its parts are one thing the user ate, and leaving the sour cream behind
  // in lunch while the tacos move to dinner is not a state anybody wants.
  const moving =
    entry.dishId === null
      ? [entry]
      : siblings.filter((row) => row.dishId === entry.dishId)

  async function save() {
    if (isSaving) return
    setIsSaving(true)
    try {
      for (const row of moving) {
        if (meal !== row.meal) await repo.moveEntry(row.id, meal)
        if (at !== entry.eatenAt) {
          await repo.retimeEntry(row.id, at + (row.eatenAt - entry.eatenAt))
        }
      }
      onDismiss()
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <BottomSheet onDismiss={onDismiss} panelClassName="p-4">
      <h2 className="text-[16px] font-semibold tracking-tight">{name}</h2>
      <p className="tabular mt-1 flex items-baseline gap-2 text-[12.5px]">
        <span className="font-semibold">{entry.nutrients.kcal} kcal</span>
        <MacroNumbers nutrients={entry.nutrients} />
      </p>
      {moving.length > 1 && (
        <p className="mt-1 text-[12px] text-ink-muted">
          Part of {entry.dishName} — all {moving.length} items move together.
        </p>
      )}

      <div className="mt-3 space-y-3">
        <MealTimePicker meal={meal} at={at} onMeal={setMeal} onAt={setAt} />

        <Button className="w-full" disabled={isSaving} onClick={() => void save()}>
          {isSaving ? 'Saving…' : 'Save'}
        </Button>

        <button
          onClick={() => {
            void Promise.all(moving.map((row) => repo.deleteEntry(row.id))).then(onDismiss)
          }}
          className="flex w-full items-center justify-center gap-1.5 py-2 text-[13.5px] font-semibold active:opacity-60"
          style={{ color: 'var(--status-critical)' }}
        >
          <Trash2 size={15} />
          Remove {moving.length > 1 ? `all ${moving.length} items` : ''}
        </button>
      </div>
    </BottomSheet>
  )
}
