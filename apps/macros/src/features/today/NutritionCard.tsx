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
 * Diet completeness, collapsed by default.
 *
 * Someone tracking macros didn't ask to be nagged about potassium, so this is one quiet line
 * until they open it. It also never claims more than it knows: nutrients the day's foods had no
 * data for are counted as unknown rather than zero, and the header says so.
 */
export function NutritionCard({ totals }: { totals: Nutrients }) {
  const [isOpen, setIsOpen] = useState(false)
  const quality = dietQuality(totals)
  const statuses = nutrientStatus(totals)

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
        {quality.score !== null && (
          <span
            className="tabular shrink-0 text-[13px] font-semibold"
            style={{
              color:
                quality.score >= 80
                  ? 'var(--target-on)'
                  : quality.score >= 50
                    ? 'var(--confidence-medium)'
                    : 'var(--target-under)',
            }}
          >
            {quality.score}%
          </span>
        )}
        <ChevronDown
          size={18}
          className={cn('shrink-0 text-ink-muted transition-transform', isOpen && 'rotate-180')}
        />
      </button>

      {isOpen && (
        <div className="border-t border-line px-4 py-3">
          <ul className="space-y-2">
            {statuses.map((status) => (
              <li key={status.key}>
                <div className="flex items-baseline justify-between text-[12.5px]">
                  <span className="text-ink-secondary">
                    {status.label}
                    {!status.isFloor && <span className="text-ink-muted"> (limit)</span>}
                  </span>
                  <span className="tabular text-ink-muted">
                    {formatAmount(status)}
                    {status.verdict !== 'unknown' && (
                      <span> / {Math.round(status.reference / (status.key === 'ironMg' ? 1 : 1000))}
                        {status.key === 'ironMg' ? 'mg' : 'g'}</span>
                    )}
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

          {quality.unknownCount > 0 && (
            <p className="mt-3 text-[12px] text-ink-muted">
              {quality.unknownCount} of {statuses.length} not recorded for today&rsquo;s foods —
              scored over the rest, not counted as zero.
            </p>
          )}
        </div>
      )}
    </Card>
  )
}
