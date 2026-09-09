import { useLiveQuery } from 'dexie-react-hooks'
import { Button, Card, useToast } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import type { Goal } from '@/domain/types'

const RESUME_RATE: Record<Exclude<Goal, 'maintain'>, number> = { lose: -0.5, gain: 0.25 }

/**
 * A diet break: maintenance for a while, on purpose.
 *
 * Worth a button rather than leaving people to change the goal and change it back, because the
 * check-in history is attributed per program — so a break recorded as one keeps the weeks either
 * side of it comparable, and the app can stop reporting "off pace" for a fortnight when holding
 * steady *is* the plan.
 */
export function DietBreakCard() {
  const toast = useToast()
  const program = useLiveQuery(() => repo.activeProgram(), [], undefined)
  const history = useLiveQuery(() => repo.programHistory(), [], [])
  if (!program) return null

  const isOnBreak = program.goal === 'maintain'
  // What they were doing before the break, so resuming doesn't ask them to remember.
  const previous = (history ?? []).find((row) => row.goal !== 'maintain')

  async function start(goal: Goal, ratePctPerWeek: number) {
    await repo.startProgram({
      goal,
      ratePctPerWeek,
      proteinGPerKg: program!.proteinGPerKg,
      fatMinPctKcal: program!.fatMinPctKcal,
      coachingMode: program!.coachingMode,
      cycling: program!.cycling,
    })
    toast.show(goal === 'maintain' ? 'On a diet break' : 'Back on plan')
  }

  return (
    <Card className="p-4">
      <h2 className="text-[15px] font-semibold tracking-tight">
        {isOnBreak ? 'Diet break' : 'Take a diet break'}
      </h2>
      <p className="mt-1 text-[12.5px] text-ink-muted">
        {isOnBreak
          ? 'Holding at maintenance. Your target still comes from measured expenditure, so it keeps up if that drifts — and nothing here reports you as off pace, because steady is the plan.'
          : 'A week or two at maintenance. It costs you the deficit for that time and nothing else: the trend pauses, appetite and training usually recover, and the check-in keeps measuring throughout.'}
      </p>

      {isOnBreak ? (
        <div className="mt-2.5 flex gap-2">
          {(['lose', 'gain'] as const).map((goal) => (
            <Button
              key={goal}
              variant={previous?.goal === goal ? 'primary' : 'secondary'}
              className="flex-1"
              onClick={() =>
                void start(goal, previous?.goal === goal ? previous.ratePctPerWeek : RESUME_RATE[goal])
              }
            >
              {goal === 'lose' ? 'Resume losing' : 'Resume building'}
            </Button>
          ))}
        </div>
      ) : (
        <Button
          variant="secondary"
          className="mt-2.5 w-full"
          onClick={() => void start('maintain', 0)}
        >
          Switch to maintenance
        </Button>
      )}
    </Card>
  )
}
