import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Card } from '@tracker-engine/ui'
import { cn } from '@/lib/cn'
import { dietQuality, formatAmount, nutrientStatus } from '@/lib/micronutrients'
import type { Nutrients } from '@/domain/types'

const VERDICT_COLOR: Record<string, string> = {
  short: 'var(--target-under)',
  over: 'var(--target-over)',
  ok: 'var(--target-on)',
  unknown: 'var(--confidence-low)',
}

/**
 * Diet completeness over the last week, collapsed by default.
 *
 * A week rather than today, because a single day says almost nothing about micronutrients —
 * fibre and calcium swing wildly day to day and nobody should change what they eat over one
 * low reading. Someone tracking macros also didn't ask to be nagged about potassium, so this
 * stays one quiet line until they open it, and it names the nutrients rather than reducing
 * them to a score that would mean nothing (see lib/micronutrients).
 */
export function NutritionCard({
  averages,
  dayCount,
}: {
  averages: Nutrients
  dayCount: number
}) {
  const [isOpen, setIsOpen] = useState(false)
  const quality = dietQuality(averages)
  const statuses = nutrientStatus(averages)

  return (
    <Card className="p-0">
      <button
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-sunken"
      >
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium">Nutrition</div>
          <div className="truncate text-[12.5px] text-ink-muted">{quality.summary}</div>
        </div>
        {quality.measured > 0 && (
          <span className="flex shrink-0 gap-1">
            {quality.short.length > 0 && (
              <Pill count={quality.short.length} label="low" color="var(--target-under)" />
            )}
            {quality.over.length > 0 && (
              <Pill count={quality.over.length} label="high" color="var(--target-over)" />
            )}
            {quality.short.length === 0 && quality.over.length === 0 && (
              <Pill count={quality.onTarget.length} label="in range" color="var(--target-on)" />
            )}
          </span>
        )}
        <ChevronDown
          size={18}
          className={cn('shrink-0 text-ink-muted transition-transform', isOpen && 'rotate-180')}
        />
      </button>

      {isOpen && (
        <div className="border-t border-line px-4 py-3">
          <p className="text-[12px] text-ink-muted">
            Daily average across {dayCount} logged day{dayCount === 1 ? '' : 's'}, against adult
            reference intakes.
          </p>
          <ul className="mt-2 space-y-2">
            {statuses.map((status) => (
              <li key={status.key}>
                <div className="flex items-baseline justify-between text-[12.5px]">
                  <span className="text-ink-secondary">
                    {status.label}
                    {!status.isFloor && <span className="text-ink-muted"> (limit)</span>}
                  </span>
                  <span className="tabular text-ink-muted">
                    {status.verdict === 'unknown'
                      ? 'not recorded'
                      : `${formatAmount(status)} / ${formatAmount({ ...status, amount: status.reference })}`}
                  </span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-sunken">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, Math.max(0, (status.ratio ?? 0) * 100))}%`,
                      background: VERDICT_COLOR[status.verdict],
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>

          {quality.measured < quality.tracked && (
            <p className="mt-3 text-[12px] text-ink-muted">
              {quality.tracked - quality.measured} of {quality.tracked} aren&rsquo;t recorded for
              the foods you logged — judged over the rest, never counted as zero. Foods from the
              USDA database carry the most detail.
            </p>
          )}
        </div>
      )}
    </Card>
  )
}

function Pill({ count, label, color }: { count: number; label: string; color: string }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[11.5px] font-semibold"
      style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
    >
      {count} {label}
    </span>
  )
}
