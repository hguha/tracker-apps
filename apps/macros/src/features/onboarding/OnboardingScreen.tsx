import { useState } from 'react'
import { Apple, ArrowLeft, Scale, Target, Utensils } from 'lucide-react'
import { unitsFor, weightToKg } from '@tracker-engine/core'
import { Button } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { cn } from '@/lib/cn'
import type { Goal, UnitSystem } from '@/domain/types'

/**
 * Bump to re-run setup for everyone. It's compared against the profile's
 * `onboardingVersion`, which syncs, so a reworked flow reaches every device once and a second
 * device never re-runs a version the account already finished.
 */
export const ONBOARDING_VERSION = 1

const GOALS: { id: Goal; label: string; blurb: string; rate: number }[] = [
  { id: 'lose', label: 'Lose fat', blurb: 'About 0.5% of bodyweight a week.', rate: -0.5 },
  { id: 'maintain', label: 'Maintain', blurb: 'Hold steady and eat consistently.', rate: 0 },
  { id: 'gain', label: 'Build', blurb: 'A slow surplus, about 0.25% a week.', rate: 0.25 },
]

type Step = 'welcome' | 'goal' | 'about' | 'weight' | 'done'

const ORDER: Step[] = ['welcome', 'goal', 'about', 'weight', 'done']

/**
 * First-run setup. Asks only what the first target needs and says why, because the honest
 * answer — "these numbers only seed a guess the app will replace" — is also the reassuring one.
 */
export function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>('welcome')
  const [goal, setGoal] = useState<Goal>('lose')
  const [units, setUnits] = useState<UnitSystem>('metric')
  const [height, setHeight] = useState('')
  const [birthYear, setBirthYear] = useState('')
  const [sex, setSex] = useState<'male' | 'female' | ''>('')
  const [weight, setWeight] = useState('')
  const [isBusy, setIsBusy] = useState(false)

  const index = ORDER.indexOf(step)

  async function finish() {
    setIsBusy(true)
    try {
      await repo.saveProfile({
        units,
        heightCm: height ? Number(height) : null,
        birthYear: birthYear ? Number(birthYear) : null,
        sex: sex || null,
        onboardedAt: Date.now(),
        onboardingVersion: ONBOARDING_VERSION,
      })
      const rate = GOALS.find((g) => g.id === goal)?.rate ?? 0
      await repo.startProgram({
        goal,
        ratePctPerWeek: rate,
        proteinGPerKg: 1.8,
        fatMinPctKcal: 25,
      })
      // Stored in kg; the box is in whatever the user picked two steps ago.
      if (weight) await repo.recordWeight(weightToKg(Number(weight), unitsFor(units).weight))
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
            <Button size="lg" className="w-full" onClick={() => setStep('goal')}>
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
            <Button size="lg" className="mt-4 w-full" onClick={() => setStep('about')}>
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
            <div className="grid grid-cols-3 gap-2">
              <Field label="Height (cm)" value={height} onChange={setHeight} />
              <Field label="Birth year" value={birthYear} onChange={setBirthYear} />
              <label>
                <span className="text-[11px] text-ink-muted">Sex</span>
                <select
                  value={sex}
                  onChange={(event) => setSex(event.target.value as typeof sex)}
                  className="mt-0.5 h-11 w-full rounded-xl bg-sunken px-2 text-[14px] outline-none"
                >
                  <option value="">—</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </label>
            </div>

            <div className="mt-3 flex gap-1.5">
              {(['metric', 'imperial'] as const).map((option) => (
                <button
                  key={option}
                  onClick={() => setUnits(option)}
                  className={cn(
                    'flex-1 rounded-xl py-2 text-[13.5px] capitalize',
                    option === units
                      ? 'bg-accent font-semibold text-accent-contrast'
                      : 'bg-sunken text-ink-secondary',
                  )}
                >
                  {option}
                </button>
              ))}
            </div>

            <Button
              size="lg"
              className="mt-4 w-full"
              disabled={!height || !birthYear || !sex}
              onClick={() => setStep('weight')}
            >
              Continue
            </Button>
            {/* Skipping is allowed, but named honestly: without these three there is no formula
                to seed the first target from, so the app can show totals and nothing to aim at. */}
            <button
              onClick={() => setStep('weight')}
              className="mt-2 w-full py-2 text-[13.5px] font-semibold text-ink-muted active:opacity-60"
            >
              Skip — no calorie target until I add them
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
              placeholder={`Weight (${unitsFor(units).weight})`}
              className="h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-[16px] outline-none focus:border-accent"
            />
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

function Field({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label>
      <span className="text-[11px] text-ink-muted">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-0.5 h-11 w-full rounded-xl bg-sunken px-2 text-[14px] outline-none"
      />
    </label>
  )
}
