import { MEAL_SLOTS, type MealSlot } from '@/domain/types'
import { cn } from '@/lib/cn'

const LABELS: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
}

/** Which meal this is going to. Always shown, never assumed silently — the slot is what lets
 *  the coach reason about timing, so a wrong default is a wrong answer later. */
export function MealPicker({
  value,
  onChange,
}: {
  value: MealSlot
  onChange: (meal: MealSlot) => void
}) {
  return (
    <div>
      <span className="text-[11px] text-ink-muted">Meal</span>
      <div className="mt-1 flex gap-1.5">
        {MEAL_SLOTS.map((meal) => (
          <button
            key={meal}
            onClick={() => onChange(meal)}
            aria-pressed={meal === value}
            className={cn(
              'flex-1 rounded-xl py-2 text-[12.5px]',
              meal === value
                ? 'bg-accent font-semibold text-accent-contrast'
                : 'bg-sunken text-ink-secondary',
            )}
          >
            {LABELS[meal]}
          </button>
        ))}
      </div>
    </div>
  )
}
