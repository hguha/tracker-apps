import { useLiveQuery } from 'dexie-react-hooks'
import { Minus, Plus } from 'lucide-react'
import * as repo from '@/data/repository'
import { NumberInput } from '@/features/shared/NumberInput'
import { gramsToMg, mgToGrams, portionFor } from '@/lib/nutrition'
import { portionLabel } from '@/features/shared/format'
import type { LogEntry } from '@/domain/types'

/**
 * The amount on a logged row, corrected in place.
 *
 * Three cases, and the third is the one that used to be an apology.
 *
 * 1. **A food logged by portion** steps by that portion, so "2 slices" becomes "3 slices" rather
 *    than collapsing into "84 g" — which is what the old stepper did, and which then poisoned the
 *    prefill for that food forever after.
 * 2. **A food logged by weight** steps in grams.
 * 3. **A quick add** has its calories and macros edited directly. The screen used to say "a quick
 *    add has no food behind it, so its amount can't be rescaled" — a sentence about a null column,
 *    shown to somebody who just wanted to change 520 to 480. A quick add *is* four numbers, so the
 *    four numbers are editable.
 */
export function AmountStepper({ entry, label }: { entry: LogEntry; label: string }) {
  if (entry.quickAdd !== null) return <QuickAddFields entry={entry} />
  if (entry.foodId === null) {
    // A recipe logged as a single serving: servings are the amount, and there is no food to rescale
    // from, so it is edited through the recipe rather than here.
    return (
      <span className="min-w-0 flex-1 text-[11.5px] text-ink-muted">
        Logged from a recipe — open the recipe to change the servings.
      </span>
    )
  }
  return <GramsOrPortions entry={entry} label={label} />
}

function GramsOrPortions({ entry, label }: { entry: LogEntry; label: string }) {
  const food = useLiveQuery(
    async () => (entry.foodId ? ((await repo.getFood(entry.foodId)) ?? null) : null),
    [entry.foodId],
    null,
  )
  const portion = food && entry.portionId ? portionFor(food, entry.portionId) : null

  if (portion && portion.grams > 0) {
    const count = entry.portionCount ?? Math.max(1, Math.round(entry.grams / portion.grams))
    return (
      <>
        <Stepper
          label={label}
          value={count}
          onChange={(next) => void repo.updateEntryAmount(entry.id, next * portion.grams)}
        />
        <span className="tabular min-w-0 flex-1 text-[11.5px] text-ink-muted">
          × {portionLabel(portion)} · {Math.round(entry.grams)} g
        </span>
      </>
    )
  }

  const step = entry.grams >= 200 ? 25 : entry.grams >= 50 ? 10 : 5
  return (
    <>
      <Stepper
        label={label}
        value={Math.round(entry.grams)}
        step={step}
        onChange={(next) => void repo.updateEntryAmount(entry.id, next)}
      />
      <span className="tabular min-w-0 flex-1 text-[11.5px] text-ink-muted">
        grams{entry.estimate ? ' · estimated, worth a check' : ''}
      </span>
    </>
  )
}

/** A quick add's four numbers, written as they're typed. */
function QuickAddFields({ entry }: { entry: LogEntry }) {
  const macros = entry.quickAdd!
  return (
    <div className="grid min-w-0 flex-1 grid-cols-4 gap-1.5">
      <Field label="kcal" value={Math.round(macros.kcal)} onChange={(v) => void repo.updateQuickAdd(entry.id, { kcal: v })} />
      <Field
        label="P"
        value={Math.round(mgToGrams(macros.proteinMg))}
        onChange={(v) => void repo.updateQuickAdd(entry.id, { proteinMg: gramsToMg(v) })}
        color="var(--macro-protein)"
      />
      <Field
        label="C"
        value={Math.round(mgToGrams(macros.carbsMg))}
        onChange={(v) => void repo.updateQuickAdd(entry.id, { carbsMg: gramsToMg(v) })}
        color="var(--macro-carbs)"
      />
      <Field
        label="F"
        value={Math.round(mgToGrams(macros.fatMg))}
        onChange={(v) => void repo.updateQuickAdd(entry.id, { fatMg: gramsToMg(v) })}
        color="var(--macro-fat)"
      />
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  color,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  color?: string
}) {
  return (
    <label className="min-w-0 rounded-lg bg-page px-1.5 py-1">
      <span className="flex items-center gap-1 text-[10px] text-ink-muted">
        {color && <span className="size-1.5 rounded-full" style={{ background: color }} aria-hidden />}
        {label}
      </span>
      <NumberInput
        inputMode="numeric"
        value={value}
        onValue={onChange}
        aria-label={label}
        className="tabular w-full bg-transparent text-[13px] outline-none"
      />
    </label>
  )
}

function Stepper({
  label,
  value,
  step = 1,
  onChange,
}: {
  label: string
  value: number
  step?: number
  onChange: (value: number) => void
}) {
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-lg bg-page p-0.5">
      <button
        onClick={() => onChange(Math.max(step, value - step))}
        aria-label={`Less ${label}`}
        className="flex size-7 items-center justify-center rounded-md text-ink-secondary active:bg-sunken"
      >
        <Minus size={14} />
      </button>
      <NumberInput
        inputMode="numeric"
        value={value}
        onValue={onChange}
        allowZero={false}
        aria-label={`Amount of ${label}`}
        className="tabular w-12 bg-transparent text-center text-[13px] outline-none"
      />
      <button
        onClick={() => onChange(value + step)}
        aria-label={`More ${label}`}
        className="flex size-7 items-center justify-center rounded-md text-ink-secondary active:bg-sunken"
      >
        <Plus size={14} />
      </button>
    </span>
  )
}
