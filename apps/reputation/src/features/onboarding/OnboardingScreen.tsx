import { useEffect, useState } from 'react'
import { ArrowRight, Check, ChevronLeft, Dumbbell, Loader2, Sparkles } from 'lucide-react'
import * as repo from '@/data/repository'
import { useAuth } from '@/auth/AuthContext'
import { useSync } from '@/sync/useSync'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { AccentPicker } from '@/components/AccentPicker'
import { PillSelect } from '@/components/PillSelect'
import { cn } from '@/lib/cn'
import { THEME_PRESETS, type ColorSchemePreference } from '@/lib/theme'
import { lengthToCm, parseNumber, weightToKg } from '@/lib/units'
import type { DistanceUnit, WeightUnit } from '@/domain/types'

// Bump to re-show the walkthrough to everyone (App gates on profile.onboardingVersion).
export const ONBOARDING_VERSION = 1

type Step = 'welcome' | 'name' | 'units' | 'body' | 'about' | 'goal' | 'look' | 'sync'

// welcome and sync frame the flow; the middle steps carry the dots + skip.
const FLOW: Step[] = ['name', 'units', 'body', 'about', 'goal', 'look']
const ALL_STEPS: Step[] = ['welcome', ...FLOW, 'sync']

const SEX_OPTIONS: { value: 'male' | 'female'; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
]

const EXPERIENCE_OPTIONS: {
  value: 'beginner' | 'intermediate' | 'advanced'
  label: string
}[] = [
  { value: 'beginner', label: 'New' },
  { value: 'intermediate', label: 'Some' },
  { value: 'advanced', label: 'Lots' },
]

const GOAL_SUGGESTIONS = [
  'Get stronger on the big lifts',
  'Build muscle',
  'Lean out',
  'Stay consistent',
  'Train for a race',
]

const SCHEME_OPTIONS: { value: ColorSchemePreference; label: string }[] = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

export function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const { session, updateDisplayName } = useAuth()
  const sync = useSync()

  const [step, setStep] = useState<Step>('welcome')
  const [name, setName] = useState(session?.displayName ?? '')
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('lb')
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>('mi')
  const [height, setHeight] = useState('')
  const [bodyweight, setBodyweight] = useState('')
  const [weeklyGoal, setWeeklyGoal] = useState(4)
  const [sex, setSex] = useState<'male' | 'female' | null>(null)
  const [age, setAge] = useState('')
  const [experience, setExperience] = useState<
    'beginner' | 'intermediate' | 'advanced' | null
  >(null)
  const [goal, setGoal] = useState('')
  const [theme, setTheme] = useState('default')
  const [scheme, setScheme] = useState<ColorSchemePreference>('system')
  const [accentOverride, setAccentOverride] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const lengthUnit = weightUnit === 'kg' ? 'cm' : 'in'

  useEffect(() => {
    void repo.getProfile().then((p) => {
      setWeightUnit(p.unitWeight)
      setDistanceUnit(p.unitDistance)
      setTheme(p.theme)
      setScheme(p.colorScheme)
      setAccentOverride(p.accentOverride)
      if (p.trainingGoal) setGoal(p.trainingGoal)
      setSex(p.sex)
      setExperience(p.experienceLevel)
      if (p.birthYear) setAge(String(new Date().getFullYear() - p.birthYear))
    })
  }, [])

  function goNext() {
    const i = ALL_STEPS.indexOf(step)
    setStep(ALL_STEPS[Math.min(i + 1, ALL_STEPS.length - 1)]!)
  }

  function goBack() {
    const i = ALL_STEPS.indexOf(step)
    setStep(ALL_STEPS[Math.max(i - 1, 0)]!)
  }

  // Persist the current step's answers, then advance. Each step saves only its own
  // fields so a mid-flow quit still keeps what was entered.
  async function saveAndContinue() {
    setIsSaving(true)
    try {
      if (step === 'name' && name.trim() && name.trim() !== session?.displayName) {
        await updateDisplayName(name.trim())
      }
      if (step === 'units') {
        await repo.updateProfile({
          unitWeight: weightUnit,
          unitDistance: distanceUnit,
          unitLength: lengthUnit,
        })
      }
      if (step === 'body') {
        const h = parseNumber(height)
        const bw = parseNumber(bodyweight)
        await repo.updateProfile({
          heightCm: h !== null && h > 0 ? lengthToCm(h, lengthUnit) : null,
          weeklyWorkoutGoal: weeklyGoal,
          // The aim doubles as the coach's default availability; refine in settings.
          trainingDaysPerWeek: weeklyGoal,
        })
        if (bw !== null && bw > 0) {
          await repo.addMetricEntry({
            definitionId: 'bodyweight',
            value: weightToKg(bw, weightUnit),
          })
        }
      }
      if (step === 'about') {
        const years = parseNumber(age)
        await repo.updateProfile({
          sex,
          experienceLevel: experience,
          birthYear:
            years !== null && years > 0 && years < 120
              ? new Date().getFullYear() - Math.round(years)
              : null,
        })
      }
      if (step === 'goal') {
        await repo.updateProfile({ trainingGoal: goal.trim() })
      }
      goNext()
    } finally {
      setIsSaving(false)
    }
  }

  if (step === 'welcome') {
    return <WelcomeStep onStart={goNext} />
  }

  const flowIndex = FLOW.indexOf(step)

  return (
    <div className="flex h-full flex-col bg-page">
      <header className="flex items-center gap-2 px-4 pt-safe">
        <div className="flex h-12 w-full items-center gap-3">
          <button
            onClick={goBack}
            aria-label="Back"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-secondary active:bg-sunken"
          >
            <ChevronLeft size={22} />
          </button>
          {step !== 'sync' && <StepDots activeIndex={flowIndex} />}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <div className="mx-auto w-full max-w-sm pt-6">
          {step === 'name' && (
            <StepShell
              title="What should we call you?"
              body="Used for the greeting on Home. Nothing else."
            >
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveAndContinue()
                }}
                placeholder="Your name"
                className="h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-[16px] outline-none focus:border-accent"
              />
              <ContinueButton
                onClick={() => void saveAndContinue()}
                disabled={isSaving}
              />
            </StepShell>
          )}

          {step === 'units' && (
            <StepShell
              title="Your units"
              body="How weights and distances show up everywhere. Change them any time in Settings."
            >
              <Field label="Weight">
                <Segmented<WeightUnit>
                  options={[
                    { value: 'lb', label: 'Pounds (lb)' },
                    { value: 'kg', label: 'Kilograms (kg)' },
                  ]}
                  value={weightUnit}
                  onChange={setWeightUnit}
                />
              </Field>
              <Field label="Distance">
                <Segmented<DistanceUnit>
                  options={[
                    { value: 'mi', label: 'Miles' },
                    { value: 'km', label: 'Kilometers' },
                  ]}
                  value={distanceUnit}
                  onChange={setDistanceUnit}
                />
              </Field>
              <ContinueButton
                onClick={() => void saveAndContinue()}
                disabled={isSaving}
              />
            </StepShell>
          )}

          {step === 'body' && (
            <StepShell
              title="A few numbers"
              body="These let the coach tailor loads and rep ranges to you. Optional — skip anything you'd rather not share."
            >
              <Field label={`Height (${lengthUnit})`}>
                <input
                  inputMode="decimal"
                  value={height}
                  onChange={(event) => setHeight(event.target.value)}
                  placeholder="—"
                  className="h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-[16px] outline-none focus:border-accent"
                />
              </Field>
              <Field label={`Bodyweight (${weightUnit})`}>
                <input
                  inputMode="decimal"
                  value={bodyweight}
                  onChange={(event) => setBodyweight(event.target.value)}
                  placeholder="—"
                  className="h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-[16px] outline-none focus:border-accent"
                />
              </Field>
              <Field label="Workouts per week you're aiming for">
                <div className="flex gap-1.5">
                  {[2, 3, 4, 5, 6].map((count) => (
                    <button
                      key={count}
                      onClick={() => setWeeklyGoal(count)}
                      className={cn(
                        'h-11 flex-1 rounded-lg text-[14px] font-semibold',
                        weeklyGoal === count
                          ? 'bg-accent text-accent-contrast'
                          : 'bg-sunken text-ink-secondary',
                      )}
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </Field>
              <ContinueButton
                onClick={() => void saveAndContinue()}
                disabled={isSaving}
              />
            </StepShell>
          )}

          {step === 'about' && (
            <StepShell
              title="About you"
              body="Helps the coach match strength standards and pace progression. All optional."
            >
              <Field label="Sex">
                <PillSelect<'male' | 'female'>
                  options={SEX_OPTIONS}
                  value={sex}
                  onChange={setSex}
                />
              </Field>
              <Field label="Age">
                <input
                  inputMode="numeric"
                  value={age}
                  onChange={(event) => setAge(event.target.value)}
                  placeholder="—"
                  className="h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-[16px] outline-none focus:border-accent"
                />
              </Field>
              <Field label="Lifting experience">
                <PillSelect<'beginner' | 'intermediate' | 'advanced'>
                  options={EXPERIENCE_OPTIONS}
                  value={experience}
                  onChange={setExperience}
                />
              </Field>
              <ContinueButton
                onClick={() => void saveAndContinue()}
                disabled={isSaving}
              />
            </StepShell>
          )}

          {step === 'goal' && (
            <StepShell
              title="What are you training for?"
              body="The coach builds toward this, literally. Change it any time in Me → Coaching."
            >
              <input
                autoFocus
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                placeholder="e.g. squat 405 by spring"
                className="h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-[16px] outline-none focus:border-accent"
              />
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {GOAL_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setGoal(suggestion)}
                    className="rounded-full border border-line px-2.5 py-1 text-[12.5px] text-ink-secondary active:bg-accent-wash"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
              <ContinueButton
                onClick={() => void saveAndContinue()}
                disabled={isSaving}
              />
            </StepShell>
          )}

          {step === 'look' && (
            <StepShell title="Make it yours" body="Changeable any time in settings.">
              <Field label="Appearance">
                <Segmented<ColorSchemePreference>
                  options={SCHEME_OPTIONS.map((o) => ({
                    value: o.value,
                    label: o.label,
                  }))}
                  value={scheme}
                  onChange={(next) => {
                    setScheme(next)
                    void repo.updateProfile({ colorScheme: next })
                  }}
                />
              </Field>
              <Field label="Theme">
                <div className="grid grid-cols-2 gap-2">
                  {THEME_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      // Written immediately so App's appearance live-query repaints.
                      onClick={() => {
                        setTheme(preset.id)
                        void repo.updateProfile({ theme: preset.id })
                      }}
                      className={cn(
                        'rounded-xl border p-3 text-left',
                        theme === preset.id
                          ? 'border-accent bg-accent-wash'
                          : 'border-line bg-surface',
                      )}
                    >
                      <span className="flex items-center justify-between">
                        <span className="text-[14px] font-semibold">{preset.label}</span>
                        {theme === preset.id && (
                          <Check size={15} className="text-accent" />
                        )}
                      </span>
                      <span
                        className="mt-2 block h-3.5 w-10 rounded-full"
                        style={{ background: preset.swatch }}
                        aria-hidden
                      />
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Accent color">
                <AccentPicker
                  accentOverride={accentOverride}
                  onChange={(next) => {
                    setAccentOverride(next)
                    // Written immediately so App's appearance live-query repaints.
                    void repo.updateProfile({ accentOverride: next })
                  }}
                />
              </Field>
              <ContinueButton
                onClick={() => void saveAndContinue()}
                disabled={isSaving}
                label="Almost done"
              />
            </StepShell>
          )}

          {step === 'sync' && <SyncStep sync={sync} onDone={onDone} />}
        </div>
      </div>

      {step !== 'sync' && (
        <button
          onClick={goNext}
          className="pb-safe py-4 text-center text-[13.5px] font-semibold text-ink-muted active:opacity-60"
        >
          Skip for now
        </button>
      )}
    </div>
  )
}

function WelcomeStep({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-page px-8 pb-safe pt-safe text-center">
      <div className="flex size-20 items-center justify-center rounded-3xl bg-accent text-accent-contrast shadow-lg shadow-accent/25">
        <Dumbbell size={38} />
      </div>
      <h1 className="mt-6 text-[30px] font-bold tracking-tight">Welcome to REPutation</h1>
      <p className="mt-2 max-w-xs text-[15px] leading-relaxed text-ink-secondary">
        A fast, private log for your training — every set, PR, and trend, saved on your
        device and synced if you want it.
      </p>
      <Button size="lg" className="mt-8 w-full max-w-xs" onClick={onStart}>
        Let's set up <ArrowRight size={17} />
      </Button>
      <p className="mt-3 text-[12.5px] text-ink-muted">Takes about a minute.</p>
    </div>
  )
}

function ContinueButton({
  onClick,
  disabled,
  label = 'Continue',
}: {
  onClick: () => void
  disabled: boolean
  label?: string
}) {
  return (
    <Button size="lg" className="mt-4 w-full" disabled={disabled} onClick={onClick}>
      {label} <ArrowRight size={17} />
    </Button>
  )
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="flex gap-1 rounded-xl bg-sunken p-1">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'h-10 flex-1 rounded-lg text-[14px] font-semibold transition-colors',
            value === option.value
              ? 'bg-surface text-ink shadow-sm'
              : 'text-ink-secondary',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function SyncStep({
  sync,
  onDone,
}: {
  sync: ReturnType<typeof useSync>
  onDone: () => void
}) {
  const [state, setState] = useState<'running' | 'done' | 'partial'>('running')
  const [pushed, setPushed] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!sync.enabled) {
        if (!cancelled) setState('done')
        return
      }
      const result = await sync.uploadEverything(({ pushed: n }) => {
        if (!cancelled) setPushed(n)
      })
      if (cancelled) return
      setPushed(result.pushed)
      setState(result.remaining > 0 ? 'partial' : 'done')
    })()
    return () => {
      cancelled = true
    }
    // Run once; sync's identity changes on every count update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <StepShell
      title={state === 'running' ? 'Getting you set up' : "You're ready"}
      body={
        state === 'running'
          ? 'Uploading anything you logged on this device so it lives in your account.'
          : state === 'partial'
            ? "Most of it is up. A few changes are still queued — they'll go up on their own, and you can check progress in Me → Data."
            : sync.enabled
              ? 'Everything on this device is in your account.'
              : "You're all set — your workouts are saved right here on this device."
      }
    >
      <Card className="flex items-center gap-3 p-4">
        {state === 'running' ? (
          <Loader2 size={20} className="shrink-0 animate-spin text-accent" />
        ) : (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-contrast">
            <Sparkles size={16} />
          </span>
        )}
        <span className="min-w-0 flex-1 text-[13.5px]">
          {state === 'running'
            ? pushed > 0
              ? `Uploaded ${pushed} ${pushed === 1 ? 'change' : 'changes'}…`
              : 'Checking what needs uploading…'
            : !sync.enabled
              ? 'Saved on this device.'
              : pushed > 0
                ? `Uploaded ${pushed} ${pushed === 1 ? 'change' : 'changes'}.`
                : 'Nothing needed uploading.'}
        </span>
      </Card>

      <Button
        size="lg"
        className="mt-4 w-full"
        disabled={state === 'running'}
        onClick={onDone}
      >
        {state === 'running' ? 'Working…' : 'Start logging'}
      </Button>
    </StepShell>
  )
}

function StepShell({
  title,
  body,
  children,
}: {
  title: string
  body: string
  children: React.ReactNode
}) {
  return (
    <>
      <h1 className="mt-4 text-[24px] font-bold tracking-tight">{title}</h1>
      <p className="mt-1.5 mb-5 text-[14.5px] leading-snug text-ink-secondary">{body}</p>
      {children}
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </label>
      {children}
    </div>
  )
}

function StepDots({ activeIndex }: { activeIndex: number }) {
  return (
    <div className="flex flex-1 gap-1.5" aria-hidden>
      {FLOW.map((s, i) => (
        <span
          key={s}
          className={cn(
            'h-1 flex-1 rounded-full transition-colors',
            i <= activeIndex ? 'bg-accent' : 'bg-line-strong',
          )}
        />
      ))}
    </div>
  )
}
