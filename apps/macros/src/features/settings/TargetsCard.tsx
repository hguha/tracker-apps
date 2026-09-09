import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { bodyWeightFromKg, weightToKg } from '@tracker-engine/core'
import { useUnits } from '@/features/shared/useUnits'
import type { Program } from '@/domain/types'
import { Card, PillSelect } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { mgToGrams } from '@/lib/nutrition'
import type { CoachingMode, Goal } from '@/domain/types'

const MODES: { id: CoachingMode; label: string; blurb: string }[] = [
  { id: 'coached', label: 'Coached', blurb: 'Targets update themselves each week.' },
  { id: 'collaborative', label: 'Ask me', blurb: 'New targets wait for your approval.' },
  { id: 'manual', label: 'Manual', blurb: 'Never changes your targets.' },
]

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
                // A goal weight survives a change of direction — someone switching from lose to
                // maintain still knows what number they were after.
                targetKg: goal === 'maintain' ? null : program.targetKg,
              })
            }}
          />
        </Field>

        {program.goal !== 'maintain' && <GoalWeightField program={program} />}

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

      <h3 className="mt-4 text-[13.5px] font-semibold">Weekly check-in</h3>
      <div className="mt-1.5 flex gap-1.5">
        {MODES.map((mode) => (
          <button
            key={mode.id}
            disabled={!program}
            onClick={() => {
              if (!program) return
              void repo.setCoachingMode(program.id, mode.id)
            }}
            className={
              program?.coachingMode === mode.id
                ? 'flex-1 rounded-xl bg-accent py-2 text-[13px] font-semibold text-accent-contrast'
                : 'flex-1 rounded-xl bg-sunken py-2 text-[13px] text-ink-secondary disabled:opacity-40'
            }
          >
            {mode.label}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[12px] text-ink-muted">
        {MODES.find((mode) => mode.id === program?.coachingMode)?.blurb ??
          'Pick a goal first.'}
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

/**
 * The weight this program is aiming at.
 *
 * A number, not a pill list, because it's personal and nobody's goal lands on a preset. Committed on
 * blur rather than per keystroke: each save re-baselines progress, and doing that mid-typing would
 * reset the bar four times on the way to "82".
 */
function GoalWeightField({ program }: { program: Program }) {
  const units = useUnits()
  const stored = program.targetKg === null ? '' : String(bodyWeightFromKg(program.targetKg, units.weight))
  const [value, setValue] = useState(stored)

  const commit = () => {
    const entered = Number(value)
    if (value.trim() === '') {
      void repo.setGoalWeight(program.id, null)
      return
    }
    if (!Number.isFinite(entered) || entered <= 0) {
      setValue(stored)
      return
    }
    void repo.setGoalWeight(program.id, weightToKg(entered, units.weight))
  }

  return (
    <Field
      label="Goal weight"
      hint={
        program.targetKg === null
          ? 'Optional — but it is what gives the goal an end, and a date'
          : program.startKg === null
            ? `Aiming for ${bodyWeightFromKg(program.targetKg, units.weight)} ${units.weight}`
            : `From ${bodyWeightFromKg(program.startKg, units.weight)} to ${bodyWeightFromKg(program.targetKg, units.weight)} ${units.weight}`
      }
    >
      <input
        type="number"
        inputMode="decimal"
        step="0.1"
        // Keyed on the unit so switching kg/lb re-reads the stored value into the box.
        key={units.weight}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        placeholder={units.weight}
        className="tabular w-full rounded-xl bg-sunken px-3 py-2 text-[15px] outline-none"
      />
    </Field>
  )
}
