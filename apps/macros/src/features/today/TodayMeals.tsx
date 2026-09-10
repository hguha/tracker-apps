import { Card } from '@tracker-engine/ui'
import { Plus } from 'lucide-react'
import { mealGroups } from '@/lib/dayGroups'
import { MEAL_LABELS } from '@/lib/meals'
import { entryName } from '@/features/shared/entryName'
import { MEAL_SLOTS, type Food, type LogEntry, type MealSlot } from '@/domain/types'

/**
 * What you have eaten today, on the home screen.
 *
 * Home used to show a calorie ring, a weigh-in box, a goal, a nutrition accordion, a badge strip and
 * a coach button — and not the food. Seeing the diary meant tapping the ring, which is not something
 * anybody would guess, and the hint compensating for it ("4 items today — tap to see them") is the
 * tell that an affordance was missing rather than hidden.
 *
 * Every meal slot has a row whether or not it has food in it, so "+" is always where you expect and
 * always lands in the right meal. That is the whole reason it isn't just a list of what's logged: the
 * empty rows are the useful ones.
 */
export function TodayMeals({
  entries,
  foods,
  onOpenDay,
  onAdd,
}: {
  entries: readonly LogEntry[]
  foods: ReadonlyMap<string, Food>
  onOpenDay: () => void
  onAdd: (meal: MealSlot) => void
}) {
  const groups = mealGroups(entries)
  const byMeal = new Map(groups.map((group) => [group.meal, group]))

  return (
    <Card className="p-0">
      <ul className="divide-y divide-line">
        {MEAL_SLOTS.map((slot) => {
          const group = byMeal.get(slot)
          // A dish contributes its own name; a lone food contributes the food's. Both are what the
          // user would call the thing, which is the only useful summary at this width.
          const names = group
            ? group.dishes.map((dish) => dish.name ?? entryName(dish.entries[0]!, foods))
            : []

          return (
            <li key={slot} className="flex items-center">
              <button
                onClick={onOpenDay}
                className="min-w-0 flex-1 px-4 py-2.5 text-left active:bg-sunken"
              >
                <span className="flex items-baseline gap-2">
                  <span className="shrink-0 text-[13.5px] font-medium">{MEAL_LABELS[slot]}</span>
                  <span className="tabular min-w-0 flex-1 truncate text-right text-[13px]">
                    {group ? (
                      `${group.nutrients.kcal} kcal`
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </span>
                </span>
                {names.length > 0 && (
                  <span className="mt-0.5 block truncate text-[12px] text-ink-muted">
                    {names.join(', ')}
                  </span>
                )}
              </button>
              <button
                onClick={() => onAdd(slot)}
                aria-label={`Add to ${MEAL_LABELS[slot].toLowerCase()}`}
                className="mr-2 flex size-9 shrink-0 items-center justify-center rounded-lg text-accent active:bg-accent-wash"
              >
                <Plus size={18} />
              </button>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
