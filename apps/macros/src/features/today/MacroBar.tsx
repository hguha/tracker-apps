import { cn } from '@/lib/cn'
import { grams } from '@/features/shared/format'

/** Progress toward one macro target. Over-target overfills rather than clipping, because
 *  hiding the overshoot is the one thing a tracker must not do. */
export function MacroBar({
  label,
  eatenMg,
  targetMg,
  barClassName,
}: {
  label: string
  eatenMg: number
  targetMg: number
  barClassName: string
}) {
  const pct = targetMg > 0 ? (eatenMg / targetMg) * 100 : 0
  const over = pct > 100
  return (
    <div>
      <div className="flex items-baseline justify-between text-[12.5px]">
        <span className="font-medium text-ink-secondary">{label}</span>
        <span className="tabular text-ink-muted">
          {grams(eatenMg)}
          {targetMg > 0 && <span className="text-ink-muted"> / {grams(targetMg)}</span>}
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
