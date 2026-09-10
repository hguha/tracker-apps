import * as repo from '@/data/repository'
import { cn } from '@/lib/cn'
import { VENUE_ICONS, VENUE_LABELS } from '@/features/shared/venue'
import { VENUES, type LogEntry, type Venue } from '@/domain/types'

/**
 * Where a meal was eaten, asked on the meal itself.
 *
 * It used to be asked in the *log* flow, which is the one place the answer is least available: on the
 * photo and describe paths the control wasn't even reachable, so the field was most often blank
 * exactly on the restaurant meals it exists to measure. Here the meal is finished and in front of
 * you, and one tap covers every row in it.
 *
 * Nothing is pre-selected. A default of "home" would be right most of the time and would therefore be
 * indistinguishable, in the data, from an answer — and the chart built on it would report the default
 * back as a habit. Unset stays unset until someone says.
 */
export function VenueChoice({ entries }: { entries: readonly LogEntry[] }) {
  const current = entries.find((entry) => entry.venue !== null)?.venue ?? null
  const ids = entries.map((entry) => entry.id)

  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-[11px] text-ink-muted">
        {current === null ? 'Cooked it, or ate out?' : 'Eaten'}
      </span>
      <div className="flex min-w-0 flex-1 justify-end gap-1.5">
        {VENUES.map((venue) => {
          const Icon = VENUE_ICONS[venue]
          const isActive = venue === current
          // Tapping the active one clears it, so a mis-tap doesn't leave a wrong fact behind with no
          // way back to "didn't say".
          const next: Venue | null = isActive ? null : venue
          return (
            <button
              key={venue}
              onClick={() => void repo.setVenue(ids, next)}
              aria-pressed={isActive}
              className={cn(
                'flex items-center gap-1 rounded-lg border px-2 py-1 text-[11.5px]',
                isActive
                  ? 'border-accent bg-accent font-semibold text-accent-contrast'
                  // Dashed while unanswered: an outline that reads as a blank to fill, rather than
                  // three more grey pills of the kind the screen is already full of.
                  : current === null
                    ? 'border-dashed border-accent/60 bg-accent-wash text-accent'
                    : 'border-transparent bg-sunken text-ink-secondary',
              )}
            >
              <Icon size={12} className="shrink-0" />
              {VENUE_LABELS[venue]}
            </button>
          )
        })}
      </div>
    </div>
  )
}
