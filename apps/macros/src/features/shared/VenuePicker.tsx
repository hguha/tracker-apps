import { cn } from '@/lib/cn'
import { VENUES, type Venue } from '@/domain/types'
import { VENUE_ICONS, VENUE_LABELS } from '@/features/shared/venue'

/**
 * Where this is being eaten.
 *
 * Three taps' worth of information that unlocks a question no macro number can answer — "the weeks
 * I ate out four times, what happened to my intake?" — so it sits in the logging flow rather than
 * behind an edit sheet, where it would be recorded roughly never.
 *
 * Nothing is pre-selected. A default of "home" would be right most of the time and would therefore
 * be indistinguishable, in the data, from an answer — and the chart built on it would be reporting
 * the default back as a habit. Unset stays unset until someone says.
 */
export function VenuePicker({
  value,
  onChange,
  label = 'Where',
}: {
  value: Venue | null
  onChange: (venue: Venue | null) => void
  label?: string
}) {
  return (
    <div>
      <span className="text-[11px] text-ink-muted">{label}</span>
      <div className="mt-1 flex gap-1.5">
        {VENUES.map((venue) => {
          const Icon = VENUE_ICONS[venue]
          const isActive = venue === value
          return (
            <button
              key={venue}
              // Tapping the active one clears it, so a mis-tap doesn't leave a wrong fact behind
              // with no way back to "didn't say".
              onClick={() => onChange(isActive ? null : venue)}
              aria-pressed={isActive}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-[12.5px]',
                isActive
                  ? 'bg-accent font-semibold text-accent-contrast'
                  : 'bg-sunken text-ink-secondary',
              )}
            >
              <Icon size={14} />
              {VENUE_LABELS[venue]}
            </button>
          )
        })}
      </div>
    </div>
  )
}
