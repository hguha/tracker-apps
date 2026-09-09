import {
  formatRelativeDay,
  fromDateTimeInputValue,
  toDateTimeInputValue,
} from '@tracker-engine/core'
import { VenuePicker } from '@/features/shared/VenuePicker'
import { MealPicker } from './MealPicker'
import type { MealSlot, Venue } from '@/domain/types'

/**
 * Which meal, when, and where.
 *
 * The time is a first-class control rather than a hidden `Date.now()`, because "when" is data
 * here: an eating window, a fasting streak and the coach's read on meal timing are all wrong if
 * everything logged in one sitting claims to have been eaten at the same instant.
 *
 * A full datetime field, the same control REPutation uses to correct a workout's date — chips for
 * "today" and "yesterday" only ever covered two of the days someone might be catching up on.
 */
export function MealTimePicker({
  meal,
  at,
  venue,
  onMeal,
  onAt,
  onVenue,
}: {
  meal: MealSlot
  at: number
  venue: Venue | null
  onMeal: (meal: MealSlot) => void
  onAt: (at: number) => void
  onVenue: (venue: Venue | null) => void
}) {
  return (
    <div className="space-y-2">
      <MealPicker value={meal} onChange={onMeal} />
      <VenuePicker value={venue} onChange={onVenue} />

      <label className="block">
        <span className="text-[11px] text-ink-muted">
          When · {formatRelativeDay(at)}
        </span>
        <input
          type="datetime-local"
          value={toDateTimeInputValue(at)}
          onChange={(event) => {
            const next = fromDateTimeInputValue(event.target.value)
            if (Number.isFinite(next)) onAt(next)
          }}
          className="tabular mt-1 w-full rounded-xl bg-sunken px-3 py-2 text-[14px] outline-none"
        />
      </label>
    </div>
  )
}
