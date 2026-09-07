import { useLiveQuery } from 'dexie-react-hooks'
import { Card, PillSelect } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { mgToGrams } from '@/lib/nutrition'
import type { Goal } from '@/domain/types'

const GOALS: { value: Goal; label: string }[] = [
  { value: 'lose', label: 'Lose' },
  { value: 'maintain', label: 'Maintain' },
  { value: 'gain', label: 'Build' },
]

/** %/week of bodyweight. Named rather than free-numeric, because the difference between −0.5
 *  and −1.5 is the difference between sustainable and miserable, and a slider invites the latter. */
const RATES: Record<Goal, { value: number; label: string }[]> = {
  lose: [
    { value: -0.25, label: 'Gentle' },
    { value: -0.5, label: 'Steady' },
    { value: -0.75, label: 'Fast' },
  ],
  gain: [
    { value: 0.125, label: 'Lean' },
    { value: 0.25, label: 'Steady' },
    { value: 0.5, label: 'Fast' },
  ],
  maintain: [{ value: 0, label: 'Hold' }],
}

const PROTEIN = [1.4, 1.6, 1.8, 2.0, 2.2]
const FAT_MIN = [20, 25, 30]

/**
 * Goal, rate and the macro floors. The calorie number itself is never editable — it's measured,
 * and a hand-typed target is one the weekly check-in can't correct.
 */
export function TargetsCard() {
  const program = useLiveQuery(() => repo.activeProgram(), [], undefined)
  const targets = useLiveQuery(() => repo.currentTargets(), [], null)
  if (!program) return null

  const rates = RATES[program.goal]

  return (
    <Card className="p-4">
      <h2 className="text-[15px] font-semibold tracking-tight">Targets</h2>

      <div className="mt-2.5 space-y-3">
        <Field label="Goal">
          <PillSelect
            value={program.goal}
            options={GOALS}
            onChange={(goal) => {
              if (!goal) return
              const rate = RATES[goal][goal === 'maintain' ? 0 : 1]?.value ?? 0
              void repo.startProgram({
                goal,
                ratePctPerWeek: rate,
                proteinGPerKg: program.proteinGPerKg,
                fatMinPctKcal: program.fatMinPctKcal,
                coachingMode: program.coachingMode,
              })
            }}
          />
        </Field>

        {rates.length > 1 && (
          <Field label="Pace" hint={`${program.ratePctPerWeek}% of bodyweight per week`}>
            <PillSelect
              value={String(program.ratePctPerWeek)}
              options={rates.map((r) => ({ value: String(r.value), label: r.label }))}
              onChange={(value) => {
                if (value === null) return
                void repo.setProgramFields(program.id, { ratePctPerWeek: Number(value) })
              }}
            />
          </Field>
        )}

        <Field
          label="Protein floor"
          hint={
            targets
              ? `${program.proteinGPerKg} g/kg — currently ${Math.round(mgToGrams(targets.proteinMg))} g/day`
              : `${program.proteinGPerKg} g per kg of bodyweight`
          }
        >
          <PillSelect
            value={String(program.proteinGPerKg)}
            options={PROTEIN.map((g) => ({ value: String(g), label: String(g) }))}
            onChange={(value) => {
              if (value === null) return
              void repo.setProgramFields(program.id, { proteinGPerKg: Number(value) })
            }}
          />
        </Field>

        <Field label="Minimum fat" hint={`${program.fatMinPctKcal}% of calories`}>
          <PillSelect
            value={String(program.fatMinPctKcal)}
            options={FAT_MIN.map((p) => ({ value: String(p), label: `${p}%` }))}
            onChange={(value) => {
              if (value === null) return
              void repo.setProgramFields(program.id, { fatMinPctKcal: Number(value) })
            }}
          />
        </Field>
      </div>

      <p className="mt-3 text-[12px] text-ink-muted">
        Calories aren&rsquo;t set here — they&rsquo;re measured from your weight trend and what you
        log, and updated at each weekly check-in.
      </p>
    </Card>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="text-[13px] font-medium">{label}</div>
      {hint && <p className="tabular text-[12px] text-ink-muted">{hint}</p>}
      <div className="mt-1.5">{children}</div>
    </div>
  )
}
