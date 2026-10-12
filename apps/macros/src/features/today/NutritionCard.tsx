import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Card } from '@tracker-engine/ui'
import { cn, plural } from '@tracker-engine/core'
import { dietQuality, type ReferenceSex } from '@/lib/micronutrients'
import { NutrientRows } from '@/features/shared/NutrientRows'
import type { LogEntry } from '@/domain/types'
import type { CoveredNutrients } from '@/lib/nutrition'

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
  nutrition,
  dayCount,
  sex,
  entries,
}: {
  /** Averages *and* how much of the period each nutrient covers — see `sumCovered`. */
  nutrition: CoveredNutrients
  dayCount: number
  /** References differ by sex for iron, fibre and potassium — see lib/micronutrients. */
  sex: ReferenceSex
  entries: readonly LogEntry[]
}) {
  const [isOpen, setIsOpen] = useState(false)
  const quality = dietQuality(nutrition.totals, sex, nutrition.coverage)

  return (
    <Card className="p-0">
      <button
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-sunken"
      >
        <div className="min-w-0 flex-1">
          {/*
            The window is in the title, not folded away. Macros reset at midnight because a calorie
            target is a day; micronutrients don't because one day of fibre means nothing — but with
            both on the same screen and only one of them labelled, midnight read as a half-broken
            reset rather than as two deliberate windows.
          */}
          <div className="text-[14px] font-medium">
            Nutrition
            <span className="font-normal text-ink-muted">
              {' '}
              · last {plural(dayCount, 'day')}
            </span>
          </div>
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
        <div className="border-t border-line">
          <NutrientRows nutrition={nutrition} entries={entries} dayCount={dayCount} sex={sex} />
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
