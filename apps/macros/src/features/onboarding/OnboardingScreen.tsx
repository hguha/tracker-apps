import { useState } from 'react'
import { Activity, Apple, ArrowLeft, Ruler, Scale, Target, Utensils } from 'lucide-react'
import { lengthFromCm, lengthToCm, unitsFor, weightToKg } from '@tracker-engine/core'
import { Button } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { cn } from '@/lib/cn'
import { ActivityPicker } from '@/features/shared/ActivityPicker'
import { ONBOARDING_VERSION, type ActivityLevel, type Goal, type UnitSystem } from '@/domain/types'

const GOALS: { id: Goal; label: string; blurb: string; rate: number }[] = [
  { id: 'lose', label: 'Lose fat', blurb: 'About 0.5% of bodyweight a week.', rate: -0.5 },
  { id: 'maintain', label: 'Maintain', blurb: 'Hold steady and eat consistently.', rate: 0 },
  { id: 'gain', label: 'Build', blurb: 'A slow surplus, about 0.25% a week.', rate: 0.25 },
]

type Step = 'welcome' | 'goal' | 'units' | 'about' | 'activity' | 'weight' | 'done'

/**
 * Units are asked *before* the numbers, and that ordering is the whole fix.
 *
 * They used to be a toggle underneath the height field, which was hardcoded to "Height (cm)" — so
 * choosing imperial changed the label on nothing and stored 70 inches as 70 centimetres. A question
 * that changes how later questions are asked has to come first.
 */
const ORDER: Step[] = ['welcome', 'goal', 'units', 'about', 'activity', 'weight', 'done']

/**
 * Bounded values, as pickers — and pre-set to the middle of the range rather than to "—".
 *
 * Opening a 71-entry list at a blank and scrolling to your height is the clunky part; opening it at
 * 175 cm means most people move it a few notches or leave it. Pre-setting is honest here in a way it
 * would not be for a weigh-in, because these three numbers only seed the *first* target and the app
 * replaces them with measured expenditure inside a week — which is what the step already says. It
 * also removes the reason for a "skip" button that left the user in a state the home screen then
 * nagged about.
 *
 * Both units are shown on every option ("175 cm · 5′9″", "1994 · 31"), so nobody has to convert or
 * subtract in their head to check they picked the right one.
 */
const CM_RANGE = range(130, 215)
const INCH_RANGE = range(48, 84)
const THIS_YEAR = new Date().getFullYear()
const YEAR_RANGE = range(THIS_YEAR - 90, THIS_YEAR - 13).reverse()

const DEFAULT_CM = 175
const DEFAULT_INCHES = 69
const DEFAULT_YEAR = THIS_YEAR - 30

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index)
}

/** "175 cm · 5′9″" — the same height in both, so the choice needs no arithmetic to verify. */
function heightLabel(cm: number): string {
  const totalInches = Math.round(lengthFromCm(cm, 'in'))
  return `${Math.round(cm)} cm · ${Math.floor(totalInches / 12)}′${totalInches % 12}″`
}

function inchesLabel(totalInches: number): string {
  return `${Math.floor(totalInches / 12)}′${totalInches % 12}″ · ${Math.round(lengthToCm(totalInches, 'in'))} cm`
}

/**
 * First-run setup. Asks only what the first target needs and says why, because the honest
 * answer — "these numbers only seed a guess the app will replace" — is also the reassuring one.
 */
export function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>('welcome')
  const [goal, setGoal] = useState<Goal>('lose')
  const [units, setUnits] = useState<UnitSystem>('metric')
  const [cm, setCm] = useState(String(DEFAULT_CM))
  const [totalInches, setTotalInches] = useState(String(DEFAULT_INCHES))
  const [birthYear, setBirthYear] = useState(String(DEFAULT_YEAR))
  const [sex, setSex] = useState<'male' | 'female' | ''>('')
  const [activity, setActivity] = useState<ActivityLevel | null>(null)
  const [weight, setWeight] = useState('')
  const [goalWeight, setGoalWeight] = useState('')
  const [isBusy, setIsBusy] = useState(false)

  const unit = unitsFor(units)
  // One canonical height in cm, whichever way it was entered. Storage is metric always.
  const heightCm =
    units === 'imperial' ? lengthToCm(Number(totalInches), 'in') : Number(cm)
  // Sex is the only one with no defensible default, so it's the only one that gates Continue.
  const hasFacts = sex !== ''

  const index = ORDER.indexOf(step)
  /**
   * Forward through `ORDER`, never to a named step.
   *
   * Inserting the units step broke exactly this: the goal step said `setStep('about')`, so the new
   * step existed in the order and was jumped straight over. A list of steps that some transitions
   * ignore isn't a list of steps.
   */
  const next = () => setStep(ORDER[Math.min(index + 1, ORDER.length - 1)]!)

  async function finish() {
    setIsBusy(true)
    try {
      await repo.saveProfile({
        units,
        heightCm,
        birthYear: birthYear ? Number(birthYear) : null,
        sex: sex || null,
        activity,
        onboardedAt: Date.now(),
        onboardingVersion: ONBOARDING_VERSION,
      })
      // The weigh-in goes first: `startProgram` captures the trend as the goal's starting point, and
      // with no weight yet that would be null — so a goal set here would have had no denominator and
      // no progress bar, which is exactly what "I set one and it wasn't there" looked like.
      if (weight) await repo.recordWeight(weightToKg(Number(weight), unit.weight))

      const rate = GOALS.find((g) => g.id === goal)?.rate ?? 0
      await repo.startProgram({
        goal,
        ratePctPerWeek: rate,
        proteinGPerKg: 1.8,
        fatMinPctKcal: 25,
        targetKg:
          goal !== 'maintain' && goalWeight ? weightToKg(Number(goalWeight), unit.weight) : null,
      })
      onDone()
    } finally {
      setIsBusy(false)
    }
  }

  return (
    // `m-auto` inside a scroller, never `justify-center`: centring a flex container clips the
    // overflow's top, which strands the controls with the keyboard up.
    <div className="flex h-full flex-col overflow-y-auto bg-page px-6 pb-safe pt-safe">
      <div className="m-auto w-full max-w-sm py-6">
        {index > 0 && step !== 'done' && (
          <button
            onClick={() => setStep(ORDER[index - 1]!)}
            className="mb-4 flex items-center gap-1.5 text-[14px] font-semibold text-accent"
          >
            <ArrowLeft size={16} />
            Back
          </button>
        )}

        <Dots count={ORDER.length - 1} active={index} />

        {step === 'welcome' && (
          <Panel
            icon={Apple}
            title="MACROcosm"
            blurb="Log what you eat. After a week of weigh-ins the app measures what you actually burn and sets your targets from that — no formula, no wearable guesswork."
          >
            <Button size="lg" className="w-full" onClick={next}>
              Get started
            </Button>
          </Panel>
        )}

        {step === 'goal' && (
          <Panel icon={Target} title="What are you after?" blurb="You can change this any time.">
            <div className="space-y-2">
              {GOALS.map((option) => (
                <button
                  key={option.id}
                  onClick={() => setGoal(option.id)}
                  className={cn(
                    'w-full rounded-xl border px-4 py-3 text-left',
                    option.id === goal
                      ? 'border-accent bg-accent-wash'
                      : 'border-line bg-surface',
                  )}
                >
                  <div className="text-[15px] font-semibold">{option.label}</div>
                  <div className="text-[12.5px] text-ink-muted">{option.blurb}</div>
                </button>
              ))}
            </div>
            <Button size="lg" className="mt-4 w-full" onClick={next}>
              Continue
            </Button>
          </Panel>
        )}

        {step === 'units' && (
          <Panel
            icon={Ruler}
            title="Which units?"
            blurb="Everything is stored the same way underneath, so you can change this later without anything moving."
          >
            <div className="flex gap-2">
              {(
                [
                  { id: 'metric' as const, label: 'Metric', hint: 'kg · cm' },
                  { id: 'imperial' as const, label: 'Imperial', hint: 'lb · ft/in' },
                ]
              ).map((option) => (
                <button
                  key={option.id}
                  onClick={() => setUnits(option.id)}
                  className={cn(
                    'flex-1 rounded-xl py-3 text-[14px]',
                    option.id === units
                      ? 'bg-accent font-semibold text-accent-contrast'
                      : 'bg-sunken text-ink-secondary',
                  )}
                >
                  {option.label}
                  <span className="mt-0.5 block text-[11.5px] opacity-80">{option.hint}</span>
                </button>
              ))}
            </div>
            <Button size="lg" className="mt-4 w-full" onClick={next}>
              Continue
            </Button>
          </Panel>
        )}

        {step === 'about' && (
          <Panel
            icon={Utensils}
            title="A few numbers"
            blurb="Only used for your very first target. Once a week of data is in, the app measures your expenditure and these stop mattering."
          >
            <div className="space-y-2.5">
              {units === 'imperial' ? (
                <Picker
                  label="Height"
                  value={totalInches}
                  onChange={setTotalInches}
                  options={INCH_RANGE.map((n) => ({ value: String(n), label: inchesLabel(n) }))}
                />
              ) : (
                <Picker
                  label="Height"
                  value={cm}
                  onChange={setCm}
                  options={CM_RANGE.map((n) => ({ value: String(n), label: heightLabel(n) }))}
                />
              )}

              <Picker
                label="Born"
                value={birthYear}
                onChange={setBirthYear}
                options={YEAR_RANGE.map((n) => ({
                  value: String(n),
                  // The age too, so nobody has to subtract to check they scrolled to the right year.
                  label: `${n} · ${THIS_YEAR - n}`,
                }))}
              />

              {/* Two options is a pair of buttons, not a dropdown you have to open to see. */}
              <div>
                <span className="block text-[11px] text-ink-muted">Sex</span>
                <div className="mt-0.5 flex gap-2">
                  {(['female', 'male'] as const).map((option) => (
                    <button
                      key={option}
                      onClick={() => setSex(option)}
                      aria-pressed={sex === option}
                      className={cn(
                        'h-11 flex-1 rounded-xl text-[14px] capitalize',
                        sex === option
                          ? 'bg-accent font-semibold text-accent-contrast'
                          : 'bg-sunken text-ink-secondary',
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11.5px] text-ink-muted">
                  Only used for the first estimate, and for the iron and fibre references.
                </p>
              </div>
            </div>

            <Button size="lg" className="mt-4 w-full" disabled={!hasFacts} onClick={next}>
              Continue
            </Button>
            {/*
              An out, worded as a choice rather than as a punishment. It used to read "Skip — no
              calorie target until I add them", which names the consequence and leaves the user in a
              state the home screen then nags about; and this is a question some people would rather
              not answer, which is its own reason to offer the door.
            */}
            <button
              onClick={next}
              className="mt-2 w-full py-2 text-[13.5px] font-semibold text-ink-muted active:opacity-60"
            >
              I&rsquo;d rather not say
            </button>
          </Panel>
        )}

        {step === 'activity' && (
          <Panel
            icon={Activity}
            title="How active is your week?"
            blurb="The last guess the app has to make. Two weeks of logs and weigh-ins replace it with your measured expenditure."
          >
            <ActivityPicker value={activity} onChange={setActivity} />
            <Button size="lg" className="mt-4 w-full" disabled={activity === null} onClick={next}>
              Continue
            </Button>
            {/* Same door as the previous step, and the same reason: unanswered is read as moderate
                with a wider error bar, which is a state the app can be honest about. */}
            <button
              onClick={next}
              className="mt-2 w-full py-2 text-[13.5px] font-semibold text-ink-muted active:opacity-60"
            >
              I&rsquo;m not sure
            </button>
          </Panel>
        )}

        {step === 'weight' && (
          <Panel
            icon={Scale}
            title="Today's weight"
            blurb="The single most useful number here. Weigh in most days and the app can measure your expenditure instead of estimating it."
          >
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              autoFocus
              value={weight}
              onChange={(event) => setWeight(event.target.value)}
              placeholder={`Today's weight (${unit.weight})`}
              className="h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-[16px] outline-none focus:border-accent"
            />
            {goal !== 'maintain' && (
              <>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  value={goalWeight}
                  onChange={(event) => setGoalWeight(event.target.value)}
                  placeholder={`Goal weight (${unit.weight}) — optional`}
                  className="mt-2 h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-[16px] outline-none focus:border-accent"
                />
                <p className="mt-1.5 text-[12px] text-ink-muted">
                  A goal weight is what gives the goal an end, and a date. You can add or change it
                  any time.
                </p>
              </>
            )}
            <Button
              size="lg"
              className="mt-4 w-full"
              disabled={isBusy}
              onClick={() => void finish()}
            >
              {isBusy ? 'Setting up…' : 'Start logging'}
            </Button>
            <button
              onClick={() => void finish()}
              disabled={isBusy}
              className="mt-2 w-full py-2 text-[13.5px] font-semibold text-ink-muted active:opacity-60"
            >
              Skip for now
            </button>
          </Panel>
        )}
      </div>
    </div>
  )
}

function Panel({
  icon: Icon,
  title,
  blurb,
  children,
}: {
  icon: typeof Apple
  title: string
  blurb: string
  children: React.ReactNode
}) {
  return (
    <>
      <div className="mb-7 text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-contrast">
          <Icon size={26} />
        </span>
        <h1 className="mt-4 text-[24px] font-bold tracking-tight">{title}</h1>
        <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-secondary">{blurb}</p>
      </div>
      {children}
    </>
  )
}

function Dots({ count, active }: { count: number; active: number }) {
  return (
    <div className="mb-6 flex justify-center gap-1.5">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={cn(
            'h-1.5 rounded-full transition-all',
            i === active ? 'w-5 bg-accent' : 'w-1.5 bg-line-strong',
          )}
        />
      ))}
    </div>
  )
}

/**
 * A native select, not a text field.
 *
 * Height and birth year are bounded, known-shape values, and typing "1994" into a number keyboard on
 * a phone is four taps and a chance to fumble. A native picker is also the only control that gets
 * the platform's own scroll wheel on iOS.
 */
function Picker({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <label className="block min-w-0">
      <span className="block text-[11px] text-ink-muted">{label}</span>
      {/* No blank option: every picker opens on a real value, so there is nothing to represent. */}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-0.5 h-11 w-full rounded-xl bg-sunken px-2 text-[15px] outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
