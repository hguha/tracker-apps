import { Card } from '@tracker-engine/ui'
import { mgToGrams } from '@/lib/nutrition'
import type { MacroTargets, Nutrients } from '@/domain/types'

/**
 * A day in four numbers and four bars.
 *
 * Compact on purpose: this sits above the food it describes, so it has to be readable at a glance
 * and must not push the meals off the screen. Calories lead because they're the number that decides
 * anything; the macro bars are secondary and get one line each.
 */
export function DayTotals({
  totals,
  target,
  occasions,
}: {
  totals: Nutrients
  /** Null when no check-in governed this day — said out loud rather than shown as 0%. */
  target: MacroTargets | null
  occasions: number
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
          {occasions} meal{occasions === 1 ? '' : 's'}
        </p>
      </div>

      <div className="mt-3 space-y-1.5">
        <MacroLine
          label="Protein"
          mg={totals.proteinMg}
          targetMg={target?.proteinMg ?? null}
          color="var(--macro-protein)"
        />
        <MacroLine
          label="Carbs"
          mg={totals.carbsMg}
          targetMg={target?.carbsMg ?? null}
          color="var(--macro-carbs)"
        />
        <MacroLine
          label="Fat"
          mg={totals.fatMg}
          targetMg={target?.fatMg ?? null}
          color="var(--macro-fat)"
        />
      </div>
    </Card>
  )
}

function MacroLine({
  label,
  mg,
  targetMg,
  color,
}: {
  label: string
  mg: number
  targetMg: number | null
  color: string
}) {
  const grams = Math.round(mgToGrams(mg))
  const goal = targetMg === null ? null : Math.round(mgToGrams(targetMg))
  // Without a target there's nothing to be a share *of*, so the bar is left empty rather than
  // filled against an invented denominator.
  const filled = goal === null || goal <= 0 ? 0 : Math.min(100, (grams / goal) * 100)

  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-[11.5px] text-ink-muted">{label}</span>
      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-sunken">
        <span className="block h-full rounded-full" style={{ width: `${filled}%`, background: color }} />
      </span>
      <span className="tabular w-16 shrink-0 text-right text-[11.5px] text-ink-secondary">
        {grams}
        {goal === null ? ' g' : ` / ${goal}`}
      </span>
    </div>
  )
}
