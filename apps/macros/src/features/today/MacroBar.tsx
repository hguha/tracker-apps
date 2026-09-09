import { cn } from '@/lib/cn'
import { grams } from '@/features/shared/format'

/**
 * Progress toward one macro target.
 *
 * With no target it falls back to this macro's share of the day's calories rather than sitting
 * at zero: a bar that never moves reads as a broken app, and the reason it can't move (no target
 * yet) is already stated once, right below it.
 *
 * Over-target overfills rather than clipping, because hiding the overshoot is the one thing a
 * tracker must not do.
 */
export function MacroBar({
  label,
  eatenMg,
  targetMg,
  sharePct,
  barClassName,
}: {
  label: string
  eatenMg: number
  targetMg: number
  /** This macro's share of the day's calories, used when there's no target. */
  sharePct: number
  barClassName: string
}) {
  const hasTarget = targetMg > 0
  const pct = hasTarget ? (eatenMg / targetMg) * 100 : sharePct
  const over = hasTarget && pct > 100

  return (
    <div>
      <div className="flex items-baseline justify-between text-[12.5px]">
        <span className="font-medium text-ink-secondary">{label}</span>
        <span className="tabular text-ink-muted">
          {grams(eatenMg)}
          {hasTarget ? (
            <span className="text-ink-muted"> / {grams(targetMg)}</span>
          ) : (
            eatenMg > 0 && <span className="text-ink-muted"> · {Math.round(sharePct)}%</span>
          )}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken">
        <div
          className={cn('h-full rounded-full', over ? 'bg-over' : barClassName)}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
    </div>
  )
}
