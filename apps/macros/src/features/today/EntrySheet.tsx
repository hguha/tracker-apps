import { useState } from 'react'
import { BottomSheet, Button } from '@tracker-engine/ui'
import { Trash2 } from 'lucide-react'
import * as repo from '@/data/repository'
import { grams } from '@/features/shared/format'
import { MealTimePicker } from '@/features/log/MealTimePicker'
import type { LogEntry, MealSlot, Venue } from '@/domain/types'

/**
 * Correcting something already logged: amount, meal, time and where it was eaten.
 *
 * All four matter after the fact — the amount because portions are guesses, the time because a
 * batch logged at 9pm would otherwise claim breakfast happened then, which is the fastest way to
 * make every timing figure on the app wrong.
 */
export function EntrySheet({
  entry,
  name,
  siblings,
  onDismiss,
}: {
  entry: LogEntry
  name: string
  /** Every entry in the same sitting, so a venue correction covers the meal and not one dish. */
  siblings: readonly LogEntry[]
  onDismiss: () => void
}) {
  const [gramsInput, setGramsInput] = useState(String(Math.round(entry.grams)))
  const [meal, setMeal] = useState<MealSlot>(entry.meal)
  const [at, setAt] = useState(entry.eatenAt)
  const [venue, setVenue] = useState<Venue | null>(entry.venue)
  const [isSaving, setIsSaving] = useState(false)

  const canEditAmount = entry.foodId !== null
  const nextGrams = Number(gramsInput)
  const others = siblings.filter((row) => row.id !== entry.id).length

  async function save() {
    if (isSaving) return
    setIsSaving(true)
    try {
      if (canEditAmount && nextGrams > 0 && nextGrams !== Math.round(entry.grams)) {
        await repo.updateEntryAmount(entry.id, nextGrams)
      }
      if (meal !== entry.meal) await repo.moveEntry(entry.id, meal)
      if (at !== entry.eatenAt) await repo.retimeEntry(entry.id, at)
      if (venue !== entry.venue) {
        await repo.setVenue(
          siblings.length > 0 ? siblings.map((row) => row.id) : [entry.id],
          venue,
        )
      }
      onDismiss()
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <BottomSheet onDismiss={onDismiss} panelClassName="p-4">
      <h2 className="text-[16px] font-semibold tracking-tight">{name}</h2>
      <p className="tabular mt-0.5 text-[12.5px] text-ink-muted">
        {entry.nutrients.kcal} kcal · {grams(entry.nutrients.proteinMg)}P{' '}
        {grams(entry.nutrients.carbsMg)}C {grams(entry.nutrients.fatMg)}F
      </p>

      <div className="mt-3 space-y-3">
        {canEditAmount ? (
          <label className="block">
            <span className="text-[11px] text-ink-muted">Grams</span>
            <input
              type="number"
              inputMode="numeric"
              value={gramsInput}
              onChange={(event) => setGramsInput(event.target.value)}
              className="tabular mt-0.5 w-full rounded-xl bg-sunken px-3 py-2 text-[15px] outline-none"
            />
          </label>
        ) : (
          <p className="text-[12.5px] text-ink-muted">
            A quick add has no food behind it, so its macros can&rsquo;t be rescaled — delete and
            re-add to change them.
          </p>
        )}

        <MealTimePicker
          meal={meal}
          at={at}
          venue={venue}
          onMeal={setMeal}
          onAt={setAt}
          onVenue={setVenue}
        />

        {venue !== entry.venue && others > 0 && (
          <p className="text-[12px] text-ink-muted">
            Applies to all {others + 1} items eaten at this sitting.
          </p>
        )}

        <Button className="w-full" disabled={isSaving} onClick={() => void save()}>
          {isSaving ? 'Saving…' : 'Save'}
        </Button>

        <button
          onClick={() => {
            void repo.deleteEntry(entry.id).then(onDismiss)
          }}
          className="flex w-full items-center justify-center gap-1.5 py-2 text-[13.5px] font-semibold active:opacity-60"
          style={{ color: 'var(--status-critical)' }}
        >
          <Trash2 size={15} />
          Remove from today
        </button>
      </div>
    </BottomSheet>
  )
}
