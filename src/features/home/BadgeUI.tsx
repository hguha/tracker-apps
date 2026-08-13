import { BottomSheet } from '@/components/BottomSheet'
import { cn } from '@/lib/cn'
import type { BadgeState } from './badges'

export function BadgeTile({
  badge,
  showProgress,
  onClick,
}: {
  badge: BadgeState
  showProgress: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1 text-center"
      aria-label={`${badge.label} — ${badge.earned ? 'earned' : badge.detailText}`}
    >
      <span
        className={cn(
          'flex size-14 items-center justify-center rounded-2xl text-[26px]',
          badge.earned ? 'bg-accent-wash' : 'bg-sunken opacity-45 grayscale',
        )}
      >
        {badge.icon}
      </span>
      <span className="text-[11px] font-semibold leading-tight">{badge.label}</span>
      {showProgress && !badge.earned && (
        <span className="tabular text-[10.5px] text-ink-muted">{badge.detailText}</span>
      )}
    </button>
  )
}

export function BadgeDetailSheet({
  badge,
  onDismiss,
}: {
  badge: BadgeState
  onDismiss: () => void
}) {
  return (
    <BottomSheet onDismiss={onDismiss} panelClassName="p-6">
      <div className="flex flex-col items-center text-center">
        <span
          className={cn(
            'flex size-20 items-center justify-center rounded-3xl text-[40px]',
            badge.earned ? 'bg-accent-wash' : 'bg-sunken opacity-60 grayscale',
          )}
        >
          {badge.icon}
        </span>
        <h2 className="mt-3 text-[20px] font-bold tracking-tight">{badge.label}</h2>
        <p className="mt-1 text-[14px] text-ink-secondary">{badge.caption}</p>

        {badge.earned ? (
          <p className="mt-4 flex items-center gap-1.5 rounded-full bg-accent-wash px-3.5 py-1.5 text-[13px] font-semibold text-accent">
            ✓ Earned
          </p>
        ) : (
          <div className="mt-4 w-full max-w-[220px]">
            <div className="h-2 overflow-hidden rounded-full bg-sunken">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500"
                style={{ width: `${Math.round(badge.fraction * 100)}%` }}
              />
            </div>
            <p className="tabular mt-2 text-[13px] font-semibold text-ink-secondary">
              {badge.detailText}
            </p>
          </div>
        )}
      </div>
    </BottomSheet>
  )
}
