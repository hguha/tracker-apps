import { cn } from '@/lib/cn'
import { ACTIVITY_DETAILS, ACTIVITY_LABELS } from '@/lib/activity'
import { ACTIVITY_LEVELS, type ActivityLevel } from '@/domain/types'

/**
 * How active the week is, as five rows rather than a dropdown.
 *
 * A `<select>` would fit in a third of the space and hide the descriptions, which are the whole
 * reason the answer is any good: nobody knows whether they are "moderately active", and everybody
 * knows whether they train three times a week. Each row shows both, so the choice is made on the
 * description and stored as the bucket.
 */
export function ActivityPicker({
  value,
  onChange,
}: {
  value: ActivityLevel | null
  onChange: (level: ActivityLevel) => void
}) {
  return (
    <ul className="space-y-1.5" role="radiogroup" aria-label="How active are you?">
      {ACTIVITY_LEVELS.map((level) => (
        <li key={level}>
          <button
            role="radio"
            aria-checked={value === level}
            onClick={() => onChange(level)}
            className={cn(
              'w-full rounded-xl px-3 py-2.5 text-left ring-1 active:opacity-70',
              value === level ? 'bg-accent-wash ring-accent' : 'bg-sunken ring-transparent',
            )}
          >
            <span
              className={cn(
                'block text-[14px] font-semibold',
                value === level && 'text-accent',
              )}
            >
              {ACTIVITY_LABELS[level]}
            </span>
            <span className="block text-[12px] text-ink-muted">{ACTIVITY_DETAILS[level]}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
