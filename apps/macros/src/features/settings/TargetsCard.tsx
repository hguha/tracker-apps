import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { bodyWeightFromKg, cn, convertWeight, signed, weightToKg } from '@tracker-engine/core'
import { ChevronDown } from 'lucide-react'
import { Card, PillSelect } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { mgToGrams } from '@/lib/nutrition'
import { useUnits } from '@/features/shared/useUnits'
import type { CoachingMode, Goal, MacroTargets, Program } from '@/domain/types'

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
 * What you're aiming at, and — folded away — how the targets are built from it.
 *
 * Five controls used to sit in one flat list, each labelled in the app's own vocabulary: "% of
 * bodyweight per week", "g/kg", "% of calories". All correct, none of them saying what changes if you
 * move it, so the screen read as a settings dump rather than as a decision.
 *
 * Two changes. **Every hint now states the resulting number** — "1.8 g/kg → 144 g of protein a day",
 * "Steady → −0.4 kg a week" — because that is the thing the user is actually choosing. And the two
 * groups are separated: the goal and the pace are decisions people revisit, while the protein floor
 * and the fat minimum are set once and then correct forever, so they start collapsed.
 */
export function TargetsCard() {
  const program = useLiveQuery(() => repo.activeProgram(), [], undefined)
  const targets = useLiveQuery(() => repo.currentTargets(), [], null)
  const weights = useLiveQuery(() => repo.weights(), [], [])
  const units = useUnits()
  const [isOpen, setIsOpen] = useState(false)
  if (!program) return null

  const rates = RATES[program.goal]
  const latestKg = weights?.[weights.length - 1]?.kg ?? null
  // The pace as a weight per week rather than a percentage, which is the form anyone thinks in.
  const perWeek = (pct: number): string | null => {
    if (latestKg === null) return null
    const value = convertWeight((pct / 100) * latestKg, units.weight)
    return `${signed(value, 2)} ${units.weight} a week`
  }

  return (
    <>
      <Card className="p-4">
        <h2 className="text-[15px] font-semibold tracking-tight">What you&rsquo;re aiming at</h2>

        <div className="mt-2.5 space-y-3">
          <Field label="Direction">
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
            <Field
              label="Pace"
              hint={perWeek(program.ratePctPerWeek) ?? `${program.ratePctPerWeek}% of bodyweight a week`}
            >
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
        </div>

        <TodaysNumbers targets={targets} />
      </Card>

      <Card className="p-0">
        <button
          onClick={() => setIsOpen((current) => !current)}
          aria-expanded={isOpen}
          className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-sunken"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-medium">How the targets are built</span>
            <span className="block truncate text-[12.5px] text-ink-muted">
              {program.proteinGPerKg} g/kg protein · at least {program.fatMinPctKcal}% fat ·{' '}
              {MODES.find((mode) => mode.id === program.coachingMode)?.label.toLowerCase()}
            </span>
          </span>
          <ChevronDown
            size={18}
            className={cn('shrink-0 text-ink-muted transition-transform', isOpen && 'rotate-180')}
          />
        </button>

        {isOpen && (
          <div className="space-y-3 border-t border-line px-4 py-3">
            <Field
              label="Protein floor"
              hint={
                targets
                  ? `${program.proteinGPerKg} g/kg → ${Math.round(mgToGrams(targets.proteinMg))} g of protein a day`
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

            <Field
              label="Minimum fat"
              hint={
                targets
                  ? `${program.fatMinPctKcal}% of calories → at least ${Math.round(mgToGrams(targets.fatMg))} g a day`
                  : `${program.fatMinPctKcal}% of calories`
              }
            >
              <PillSelect
                value={String(program.fatMinPctKcal)}
                options={FAT_MIN.map((p) => ({ value: String(p), label: `${p}%` }))}
                onChange={(value) => {
                  if (value === null) return
                  void repo.setProgramFields(program.id, { fatMinPctKcal: Number(value) })
                }}
              />
            </Field>

            <Field
              label="Weekly check-in"
              hint={MODES.find((mode) => mode.id === program.coachingMode)?.blurb ?? ''}
            >
              <div className="flex gap-1.5">
                {MODES.map((mode) => (
                  <button
                    key={mode.id}
                    onClick={() => void repo.setCoachingMode(program.id, mode.id)}
                    className={
                      program.coachingMode === mode.id
                        ? 'flex-1 rounded-xl bg-accent py-2 text-[13px] font-semibold text-accent-contrast'
                        : 'flex-1 rounded-xl bg-sunken py-2 text-[13px] text-ink-secondary'
                    }
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </Field>

            <p className="text-[12px] text-ink-muted">
              Calories follow your weight trend and adjust weekly. Protein and fat are floors; carbs fill the rest.
            </p>
            {/* Said here because "how active am I" is the question people expect a calorie target
                to hinge on, and in this app it very nearly doesn't. */}
            <p className="text-[12px] text-ink-muted">
              Height, age, sex and how active you are (under About you) only seed the first estimate.
            </p>
          </div>
        )}
      </Card>
    </>
  )
}

/**
 * The four numbers all of the above actually produces.
 *
 * Without it the screen is a set of inputs with no visible output, which is most of why it read as
 * arbitrary — you could move the pace three times and see nothing change.
 */
function TodaysNumbers({ targets }: { targets: MacroTargets | null }) {
  if (!targets) {
    return (
      <p className="mt-3 text-[12px] text-ink-muted">
        No target yet — it needs your height, age, sex and a weigh-in.
      </p>
    )
  }
  return (
    <div className="mt-3 rounded-xl bg-sunken px-3 py-2.5">
      <p className="text-[11px] text-ink-muted">Today, this comes out as</p>
      <p className="tabular mt-0.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[13px]">
        <span className="font-semibold">{targets.kcal} kcal</span>
        <Macro grams={Math.round(mgToGrams(targets.proteinMg))} label="protein" color="var(--macro-protein)" />
        <Macro grams={Math.round(mgToGrams(targets.carbsMg))} label="carbs" color="var(--macro-carbs)" />
        <Macro grams={Math.round(mgToGrams(targets.fatMg))} label="fat" color="var(--macro-fat)" />
      </p>
    </div>
  )
}

function Macro({ grams, label, color }: { grams: number; label: string; color: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      <span>
        {grams}g <span className="text-ink-muted">{label}</span>
      </span>
    </span>
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
  useEffect(() => setValue(stored), [stored])

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
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        placeholder={units.weight}
        className="tabular w-full rounded-xl bg-sunken px-3 py-2 text-[15px] outline-none"
      />
    </Field>
  )
}
