import { plural } from '@tracker-engine/core'
import { Card } from '@tracker-engine/ui'
import { MacroBars } from '@/features/shared/MacroBar'
import type { MacroTargets, Nutrients } from '@/domain/types'

/**
 * A day in four numbers and three bars.
 *
 * Compact on purpose: this sits above the food it describes, so it has to be readable at a glance
 * and must not push the meals off the screen. Calories lead because they're the number that decides
 * anything.
 */
export function DayTotals({
  totals,
  target,
  meals,
}: {
  totals: Nutrients
  /** Null when no check-in governed this day — said out loud rather than shown as 0%. */
  target: MacroTargets | null
  meals: number
}) {
  const delta = target ? totals.kcal - target.kcal : null

  return (
    <Card className="p-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="tabular text-[30px] font-bold leading-none">{totals.kcal}</p>
          <p className="mt-0.5 text-[12px] text-ink-muted">
            {target === null
              ? 'kcal · no target for this day'
              : `of ${target.kcal} kcal · ${delta === 0 ? 'on target' : `${Math.abs(delta!)} ${delta! > 0 ? 'over' : 'under'}`}`}
          </p>
        </div>
        <p className="tabular text-right text-[12px] text-ink-muted">
          {plural(meals, 'meal')}
        </p>
      </div>

      <MacroBars eaten={totals} targets={target} className="mt-3" />
    </Card>
  )
}
