import { useLiveQuery } from 'dexie-react-hooks'
import { Card } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { cn } from '@/lib/cn'
import { DAY_NAMES, highDaysOf, multipliersForHighDays } from '@/lib/cycling'

/**
 * Calorie cycling: pick the days that get more.
 *
 * The weekly total is fixed, which is the whole point and is said plainly — otherwise "higher on
 * Saturday" reads as permission to eat more overall, and the check-in would then quietly claw it
 * back the following week, which feels like the app moving the goalposts.
 */
export function CyclingCard() {
  const program = useLiveQuery(() => repo.activeProgram(), [], undefined)
  const targets = useLiveQuery(() => repo.currentTargets(), [], null)
  if (!program) return null

  const active = program
  const highDays = highDaysOf(active.cycling)
  const multipliers = active.cycling?.multipliers ?? []

  function toggle(day: number) {
    const next = highDays.includes(day)
      ? highDays.filter((value) => value !== day)
      : [...highDays, day]
    const nextMultipliers = multipliersForHighDays(next)
    void repo.setProgramFields(active.id, {
      cycling: nextMultipliers ? { multipliers: nextMultipliers } : null,
    })
  }

  return (
    <Card className="p-4">
      <h2 className="text-[15px] font-semibold tracking-tight">Calorie cycling</h2>
      <p className="mt-1 text-[12.5px] text-ink-muted">
        Optional. Tap the days you want more on — the rest come down to match, so your weekly total
        and your rate of loss are exactly the same. Protein stays put on every day.
      </p>

      <div className="mt-2.5 flex gap-1">
        {DAY_NAMES.map((name, day) => (
          <button
            key={name}
            onClick={() => toggle(day)}
            aria-pressed={highDays.includes(day)}
            className={cn(
              'flex-1 rounded-lg py-2 text-[12px] font-semibold',
              highDays.includes(day)
                ? 'bg-accent text-accent-contrast'
                : 'bg-sunken text-ink-secondary',
            )}
          >
            {name}
          </button>
        ))}
      </div>

      {active.cycling && targets ? (
        <p className="tabular mt-2.5 text-[12px] text-ink-muted">
          {DAY_NAMES.map((name, day) => {
            const multiplier = multipliers[day] ?? 1
            return `${name} ${Math.round(targets.kcal * multiplier)}`
          }).join(' · ')}
        </p>
      ) : (
        <p className="mt-2.5 text-[12px] text-ink-muted">
          {highDays.length === 7
            ? 'Every day picked is the same as none — pick a few.'
            : 'Off: every day gets the same target.'}
        </p>
      )}
    </Card>
  )
}
