import { DAY_MS, dayKey } from '@tracker-engine/core'
import { MealPicker } from './MealPicker'
import { cn } from '@/lib/cn'
import type { MealSlot } from '@/domain/types'

/**
 * Which meal, and when.
 *
 * The time is a first-class control rather than a hidden `Date.now()`, because "when" is data
 * here: an eating window, a fasting streak and the coach's read on meal timing are all wrong if
 * everything logged in one sitting claims to have been eaten at the same instant. Yesterday is
 * offered because forgetting to log dinner is the single most common correction.
 */
export function MealTimePicker({
  meal,
  at,
  onMeal,
  onAt,
}: {
  meal: MealSlot
  at: number
  onMeal: (meal: MealSlot) => void
  onAt: (at: number) => void
}) {
  const day = dayKey(at)
  const isToday = day === dayKey(Date.now())

  function setTime(value: string) {
    const [hours, minutes] = value.split(':').map(Number)
    if (hours === undefined || Number.isNaN(hours)) return
    const next = new Date(at)
    next.setHours(hours, minutes ?? 0, 0, 0)
    onAt(next.getTime())
  }

  function setDay(offset: 0 | 1) {
    const target = new Date(Date.now() - offset * DAY_MS)
    const next = new Date(at)
    next.setFullYear(target.getFullYear(), target.getMonth(), target.getDate())
    onAt(next.getTime())
  }

  return (
    <div className="space-y-2">
      <MealPicker value={meal} onChange={onMeal} />

      <div className="flex items-end gap-2">
        <label className="flex-1">
          <span className="text-[11px] text-ink-muted">Time</span>
          <input
            type="time"
            value={clockValue(at)}
            onChange={(event) => setTime(event.target.value)}
            className="tabular mt-1 w-full rounded-xl bg-sunken px-3 py-2 text-[14px] outline-none"
          />
        </label>
        <div className="flex gap-1.5">
          {([0, 1] as const).map((offset) => (
            <button
              key={offset}
              onClick={() => setDay(offset)}
              aria-pressed={isToday === (offset === 0)}
              className={cn(
                'rounded-xl px-3 py-2 text-[12.5px]',
                isToday === (offset === 0)
                  ? 'bg-accent font-semibold text-accent-contrast'
                  : 'bg-sunken text-ink-secondary',
              )}
            >
              {offset === 0 ? 'Today' : 'Yesterday'}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

const clockValue = (at: number): string => {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
