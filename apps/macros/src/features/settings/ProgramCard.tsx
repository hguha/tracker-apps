import { useLiveQuery } from 'dexie-react-hooks'
import { Card, useToast } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import type { Goal } from '@/domain/types'

const GOALS: { id: Goal; label: string; rate: number }[] = [
  { id: 'lose', label: 'Lose', rate: -0.5 },
  { id: 'maintain', label: 'Maintain', rate: 0 },
  { id: 'gain', label: 'Gain', rate: 0.25 },
]

/** Goal and rate. Deliberately few knobs: the calorie number is the algorithm's job, and a
 *  target the user types is a target the measurement can't correct. */
export function ProgramCard() {
  const toast = useToast()
  const program = useLiveQuery(() => repo.activeProgram(), [], undefined)

  return (
    <Card className="p-4">
      <h2 className="text-[15px] font-semibold tracking-tight">Goal</h2>
      <div className="mt-2 flex gap-1.5">
        {GOALS.map((goal) => (
          <button
            key={goal.id}
            onClick={() => {
              void repo
                .startProgram({
                  goal: goal.id,
                  ratePctPerWeek: goal.rate,
                  proteinGPerKg: 1.8,
                  fatMinPctKcal: 25,
                })
                .then(() => toast.show(`Goal set to ${goal.label.toLowerCase()}`))
            }}
            className={
              program?.goal === goal.id
                ? 'flex-1 rounded-xl bg-accent py-2 text-[13.5px] font-semibold text-accent-contrast'
                : 'flex-1 rounded-xl bg-sunken py-2 text-[13.5px] text-ink-secondary'
            }
          >
            {goal.label}
          </button>
        ))}
      </div>
      {program && (
        <p className="tabular mt-2 text-[12.5px] text-ink-muted">
          {program.ratePctPerWeek === 0
            ? 'Holding weight.'
            : `${program.ratePctPerWeek > 0 ? '+' : ''}${program.ratePctPerWeek}% of bodyweight per week · ${program.proteinGPerKg} g/kg protein`}
        </p>
      )}
    </Card>
  )
}
