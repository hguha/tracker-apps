/**
 * First-run setup, shown once after a real account's first sign-in (§11.1.3).
 *
 * Two jobs, and the second is the reason this screen exists rather than a
 * settings nag:
 *
 *   1. **Prime the coach.** Height, bodyweight, weekly goal, and a stated training
 *      goal are what turn generic advice into tailored advice (§9.1). Asking once,
 *      up front, gets far better answers than hoping someone finds the settings.
 *   2. **Upload what's already here.** A user who logged workouts on this device
 *      before signing in has a full outbox, and `drain` stops at the first
 *      transient failure to preserve order — so the old experience was "sync
 *      failed", then manual retries pushing a few rows at a time. This runs
 *      `drainUntilSettled` and shows real progress until the queue is empty.
 *
 * Every answer is optional and every one is editable later in Me → Coaching, so
 * skipping costs nothing.
 */

import { useEffect, useState } from 'react'
import { ArrowRight, Check, Loader2, Sparkles } from 'lucide-react'
import * as repo from '@/data/repository'
import { useAuth } from '@/auth/AuthContext'
import { useSync } from '@/sync/useSync'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { THEME_PRESETS } from '@/lib/theme'
import { lengthToCm, parseNumber, weightToKg } from '@/lib/units'
import type { LengthUnit, WeightUnit } from '@/domain/types'

type Step = 'name' | 'body' | 'goal' | 'look' | 'sync'

const GOAL_SUGGESTIONS = [
  'Get stronger on the big lifts',
  'Build muscle',
  'Lean out',
  'Stay consistent',
  'Train for a race',
]

export function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const { session, updateDisplayName } = useAuth()
  const sync = useSync()

  const [step, setStep] = useState<Step>('name')
  const [name, setName] = useState(session?.displayName ?? '')
  const [units, setUnits] = useState<{ weight: WeightUnit; length: LengthUnit }>({
    weight: 'lb',
    length: 'in',
  })
  const [height, setHeight] = useState('')
  const [bodyweight, setBodyweight] = useState('')
  const [weeklyGoal, setWeeklyGoal] = useState(4)
  const [goal, setGoal] = useState('')
  const [theme, setTheme] = useState('default')
  const [isSaving, setIsSaving] = useState(false)

  // Load the profile's existing units, so the height/weight fields are labeled
  // in whatever the account already uses.
  useEffect(() => {
    void repo.getProfile().then((p) => {
      setUnits({ weight: p.unitWeight, length: p.unitLength })
      setTheme(p.theme)
    })
  }, [])

  async function saveAndContinue(next: Step) {
    setIsSaving(true)
    try {
      if (step === 'name' && name.trim() && name.trim() !== session?.displayName) {
        await updateDisplayName(name.trim())
      }
      if (step === 'body') {
        const h = parseNumber(height)
        const bw = parseNumber(bodyweight)
        await repo.updateProfile({
          heightCm: h !== null && h > 0 ? lengthToCm(h, units.length) : null,
          weeklyWorkoutGoal: weeklyGoal,
        })
        // Bodyweight is a metric entry, not a profile field — it's a time series,
        // and it also backfills profile.bodyweightCacheKg for the volume math.
        if (bw !== null && bw > 0) {
          await repo.addMetricEntry({
            definitionId: 'bodyweight',
            value: weightToKg(bw, units.weight),
          })
        }
      }
      if (step === 'goal') {
        await repo.updateProfile({ trainingGoal: goal.trim() })
      }
      if (step === 'look') {
        await repo.updateProfile({ theme })
      }
      setStep(next)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex h-full flex-col bg-page">
      <div className="flex-1 overflow-y-auto px-6 pb-6 pt-safe">
        <div className="mx-auto w-full max-w-sm pt-10">
          <StepDots step={step} />

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
                  if (event.key === 'Enter') void saveAndContinue('body')
                }}
                placeholder="Your name"
                className="h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-[16px] outline-none focus:border-accent"
              />
              <Button
                size="lg"
                className="mt-3 w-full"
                disabled={isSaving}
                onClick={() => void saveAndContinue('body')}
              >
                Continue <ArrowRight size={17} />
              </Button>
            </StepShell>
          )}

          {step === 'body' && (
            <StepShell
              title="A few numbers"
              body="These let the coach tailor loads and rep ranges to you. Optional — skip anything you'd rather not share."
            >
              <Field label={`Height (${units.length})`}>
                <input
                  inputMode="decimal"
                  value={height}
                  onChange={(event) => setHeight(event.target.value)}
                  placeholder="—"
                  className="h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-[16px] outline-none focus:border-accent"
                />
              </Field>
              <Field label={`Bodyweight (${units.weight})`}>
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
                      className={
                        'h-11 flex-1 rounded-lg text-[14px] font-semibold ' +
                        (weeklyGoal === count
                          ? 'bg-accent text-white'
                          : 'bg-sunken text-ink-secondary')
                      }
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </Field>
              <Button
                size="lg"
                className="mt-4 w-full"
                disabled={isSaving}
                onClick={() => void saveAndContinue('goal')}
              >
                Continue <ArrowRight size={17} />
              </Button>
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
              <Button
                size="lg"
                className="mt-4 w-full"
                disabled={isSaving}
                onClick={() => void saveAndContinue('look')}
              >
                Continue <ArrowRight size={17} />
              </Button>
            </StepShell>
          )}

          {step === 'look' && (
            <StepShell title="Pick a look" body="Changeable any time in settings.">
              <div className="grid grid-cols-2 gap-2">
                {THEME_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => setTheme(preset.id)}
                    className={
                      'rounded-xl border p-3 text-left ' +
                      (theme === preset.id
                        ? 'border-accent bg-accent-wash'
                        : 'border-line bg-surface')
                    }
                  >
                    <span className="flex items-center justify-between">
                      <span className="text-[14px] font-semibold">{preset.label}</span>
                      {theme === preset.id && <Check size={15} className="text-accent" />}
                    </span>
                  </button>
                ))}
              </div>
              <Button
                size="lg"
                className="mt-4 w-full"
                disabled={isSaving}
                onClick={() => void saveAndContinue('sync')}
              >
                Continue <ArrowRight size={17} />
              </Button>
            </StepShell>
          )}

          {step === 'sync' && <SyncStep sync={sync} onDone={onDone} />}
        </div>
      </div>

      {step !== 'sync' && (
        <button
          onClick={() => void saveAndContinue('sync')}
          className="pb-safe py-4 text-center text-[13.5px] font-semibold text-ink-muted active:opacity-60"
        >
          Skip for now
        </button>
      )}
    </div>
  )
}

/**
 * The upload step: runs `drainUntilSettled` and reports progress.
 *
 * This is what replaces "sync failed, press retry, press retry again" for a user
 * whose device already holds a history.
 */
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
      // Nothing queued and no backend: there's nothing to upload.
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
    // Runs once for this step; sync's identity changes on every count update.
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
            : 'Everything on this device is in your account.'
      }
    >
      <Card className="flex items-center gap-3 p-4">
        {state === 'running' ? (
          <Loader2 size={20} className="shrink-0 animate-spin text-accent" />
        ) : (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-white">
            <Sparkles size={16} />
          </span>
        )}
        <span className="min-w-0 flex-1 text-[13.5px]">
          {state === 'running'
            ? pushed > 0
              ? `Uploaded ${pushed} ${pushed === 1 ? 'change' : 'changes'}…`
              : 'Checking what needs uploading…'
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
      <h1 className="mt-6 text-[24px] font-bold tracking-tight">{title}</h1>
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

const STEPS: Step[] = ['name', 'body', 'goal', 'look', 'sync']

function StepDots({ step }: { step: Step }) {
  const index = STEPS.indexOf(step)
  return (
    <div className="flex gap-1.5" aria-hidden>
      {STEPS.map((s, i) => (
        <span
          key={s}
          className={
            'h-1 flex-1 rounded-full ' + (i <= index ? 'bg-accent' : 'bg-line-strong')
          }
        />
      ))}
    </div>
  )
}
