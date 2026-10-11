import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@tracker-engine/core'
import {
  formatAmount,
  nutrientSources,
  nutrientStatus,
  type ReferenceSex,
} from '@/lib/micronutrients'
import type { CoveredNutrients } from '@/lib/nutrition'
import { entryName } from '@/features/shared/entryName'
import type { Food, LogEntry, Nutrients } from '@/domain/types'

export interface NamedRow {
  name: string
  nutrients: Nutrients
}

export const namedRows = (
  entries: readonly LogEntry[],
  foods: ReadonlyMap<string, Food>,
): NamedRow[] =>
  entries.map((entry) => ({
    name: entry.dishName ?? entryName(entry, foods),
    nutrients: entry.nutrients,
  }))

export function NutrientRows({
  nutrition,
  rows,
  dayCount,
  sex,
}: {
  nutrition: CoveredNutrients
  rows: readonly NamedRow[]
  dayCount: number
  sex: ReferenceSex
}) {
  const [open, setOpen] = useState<string | null>(null)
  const statuses = nutrientStatus(nutrition.totals, sex, nutrition.coverage)
  if (statuses.every((status) => status.amount === null)) {
    return (
      <p className="px-4 py-3 text-[13px] text-ink-muted">
        None of the foods logged carried nutrient data.
      </p>
    )
  }

  return (
    <ul className="divide-y divide-line">
        {statuses.map((status) => {
          const isOpen = open === status.key
          const sources = isOpen ? nutrientSources(rows, status.key, dayCount) : null
          const ratio = status.ratio ?? 0
          return (
            <li key={status.key}>
              <button
                onClick={() => setOpen(isOpen ? null : status.key)}
                aria-expanded={isOpen}
                className="w-full px-4 py-2.5 text-left active:bg-sunken"
              >
                <span className="flex items-baseline justify-between gap-2 text-[13px]">
                  <span className="flex items-center gap-1">
                    {status.label}
                    <ChevronDown
                      size={13}
                      className={cn('text-ink-muted transition-transform', isOpen && 'rotate-180')}
                    />
                  </span>
                  <span className="tabular text-ink-muted">
                    <span className="text-ink">{formatAmount(status)}</span>
                    {' / '}
                    {formatAmount({ ...status, amount: status.reference })}
                    {!status.isFloor && ' max'}
                  </span>
                </span>
                <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-sunken">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${Math.min(100, Math.max(0, ratio * 100))}%`,
                      background: VERDICT_COLOR[status.verdict],
                    }}
                  />
                </span>
              </button>
              {sources && (
                <div className="space-y-1 px-4 pb-3">
                  {sources.top.map((source) => (
                    <p key={source.name} className="flex items-baseline gap-2 text-[12.5px]">
                      <span className="min-w-0 flex-1 truncate">{source.name}</span>
                      <span className="tabular shrink-0 text-ink-muted">
                        {formatAmount({ key: status.key, amount: source.amount })}
                      </span>
                      <span className="tabular w-9 shrink-0 text-right text-ink-muted">
                        {Math.round(source.share * 100)}%
                      </span>
                    </p>
                  ))}
                  {sources.top.length === 0 && (
                    <p className="text-[12.5px] text-ink-muted">Nothing logged contains it.</p>
                  )}
                  {sources.missing.length > 0 && (
                    <p className="pt-0.5 text-[12px] text-ink-muted">
                      Not listed for {sources.missing.join(', ')}
                    </p>
                  )}
                </div>
              )}
            </li>
          )
        })}
    </ul>
  )
}

const VERDICT_COLOR: Record<string, string> = {
  short: 'var(--target-under)',
  over: 'var(--target-over)',
  ok: 'var(--target-on)',
  unknown: 'var(--confidence-low)',
}

