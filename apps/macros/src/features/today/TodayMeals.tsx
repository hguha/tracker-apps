import { Card } from '@tracker-engine/ui'
import { Plus } from 'lucide-react'
import { mealGroups } from '@/lib/dayGroups'
import { MEAL_LABELS } from '@/lib/meals'
import { entryName } from '@/features/shared/entryName'
import type { Food, LogEntry, MealSlot } from '@/domain/types'

/**
 * What you have eaten today, on the home screen.
 *
 * Home used to show a calorie ring, a weigh-in box, a goal, a nutrition accordion, a badge strip and
 * a coach button — and not the food. Seeing the diary meant tapping the ring, which is not something
 * anybody would guess, and the hint compensating for it ("4 items today — tap to see them") is the
 * tell that an affordance was missing rather than hidden.
 *
 * **Only the meals with food in them.** The first version showed all four always, on the theory that a
 * "+" in a predictable place is worth the space. It isn't: four rows of em-dashes is most of the card
 * saying nothing, every morning. Every slot is still reachable — the tab bar's button picks by the
 * clock, and the day screen has a button per slot — so nothing is lost but the emptiness.
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
  if (groups.length === 0) return null

  return (
    <Card className="p-0">
      <ul className="divide-y divide-line">
        {groups.map((group) => {
          // A dish contributes its own name; a lone food contributes the food's. Both are what the
          // user would call the thing, which is the only useful summary at this width.
          const names = group.dishes.map(
            (dish) => dish.name ?? entryName(dish.entries[0]!, foods),
          )

          return (
            <li key={group.meal} className="flex items-center">
              <button
                onClick={onOpenDay}
                className="min-w-0 flex-1 px-4 py-2.5 text-left active:bg-sunken"
              >
                <span className="flex items-baseline gap-2">
                  <span className="shrink-0 text-[13.5px] font-medium">
                    {MEAL_LABELS[group.meal]}
                  </span>
                  <span className="tabular min-w-0 flex-1 text-right text-[13px]">
                    {group.nutrients.kcal} kcal
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-[12px] text-ink-muted">
                  {names.join(', ')}
                </span>
              </button>
              <button
                onClick={() => onAdd(group.meal)}
                aria-label={`Add to ${MEAL_LABELS[group.meal].toLowerCase()}`}
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
