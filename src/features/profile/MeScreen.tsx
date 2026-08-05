/**
 * Settings and body metrics (§5.2 `/me`, `/body`).
 *
 * Merged into one tab for the prototype — the split into separate Body and Me
 * routes matters once there are enough biomarker charts to fill a screen.
 */

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, ChevronRight, Dumbbell } from 'lucide-react'
import { db } from '@/db/database'
import * as repo from '@/data/repository'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { useToast } from '@/components/Toast'
import { useAuth } from '@/auth/AuthContext'
import { initialsOf } from '@/auth/types'
import { playCue, setSoundEnabled } from '@/features/timer/sounds'
import { AppearanceSection } from './AppearanceSection'
import { cn } from '@/lib/cn'
import { formatRelativeDay } from '@/lib/dates'
import { lengthFromCm, lengthToCm, weightFromKg, weightToKg } from '@/lib/units'
import type { DistanceUnit, LengthUnit, WeightUnit } from '@/domain/types'

/** The handful worth logging often. The rest live behind "all metrics". */
const QUICK_METRIC_KEYS = ['bodyweight', 'body_fat_pct', 'waist', 'resting_hr']

export function MeScreen({
  onOpenLibrary,
  onOpenAccount,
}: {
  onOpenLibrary: () => void
  onOpenAccount: () => void
}) {
  const toast = useToast()
  const { session } = useAuth()
  const [draftValues, setDraftValues] = useState<Record<string, string>>({})

  const data = useLiveQuery(async () => {
    const profile = await repo.getProfile()
    const definitions = await db.metricDefinitions.toArray()

    const quick = await Promise.all(
      QUICK_METRIC_KEYS.map(async (key) => {
        const definition = definitions.find((d) => d.key === key)
        if (!definition) return null
        const entries = await repo.listMetricEntries(definition.id, 5)
        return { definition, latest: entries[0], entries }
      }),
    )

    const workoutCount = (await repo.listWorkouts(500)).filter(
      (w) => w.endedAt !== null,
    ).length
    const pendingWrites = await db.outbox.count()

    return {
      profile,
      quick: quick.filter((q): q is NonNullable<typeof q> => q !== null),
      workoutCount,
      pendingWrites,
    }
  }, [])

  if (!data) return <div className="p-6 text-ink-muted">Loading…</div>

  const { profile, quick, workoutCount, pendingWrites } = data

  /** Converts a typed display value into canonical storage units. */
  function toCanonical(unitType: string, raw: number): number {
    if (unitType === 'mass') return weightToKg(raw, profile.unitWeight)
    if (unitType === 'length') return lengthToCm(raw, profile.unitLength)
    return raw
  }

  function toDisplay(unitType: string, value: number): number {
    if (unitType === 'mass') return weightFromKg(value, profile.unitWeight, 0.1)
    if (unitType === 'length') return lengthFromCm(value, profile.unitLength)
    return value
  }

  function unitSuffix(unitType: string): string {
    if (unitType === 'mass') return profile.unitWeight
    if (unitType === 'length') return profile.unitLength
    if (unitType === 'percent') return '%'
    return ''
  }

  async function saveMetric(definitionId: string, unitType: string) {
    const raw = draftValues[definitionId]
    if (!raw || raw.trim() === '') return
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return

    await repo.addMetricEntry({
      definitionId,
      value: toCanonical(unitType, parsed),
    })
    setDraftValues((current) => ({ ...current, [definitionId]: '' }))
    toast.show('Logged')
  }

  return (
    <div className="space-y-3 px-3 py-3">
      <Card className="overflow-hidden">
        <button
          onClick={onOpenAccount}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-accent-wash"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-[14px] font-bold text-white">
            {initialsOf(session?.displayName ?? '')}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold">
              {session?.displayName ?? 'Account'}
            </span>
            <span className="block truncate text-[12.5px] text-ink-muted">
              {session?.isVerified ? session.email : 'This device only'}
            </span>
          </span>
          <ChevronRight size={17} className="shrink-0 text-ink-muted" />
        </button>
        <button
          onClick={onOpenLibrary}
          className="flex w-full items-center gap-3 border-t border-line px-4 py-3.5 text-left active:bg-accent-wash"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-wash text-accent">
            <Dumbbell size={19} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Exercise library</span>
            <span className="block text-[12.5px] text-ink-muted">
              Browse, search, and edit every exercise
            </span>
          </span>
          <ChevronRight size={17} className="shrink-0 text-ink-muted" />
        </button>
      </Card>

      <Card className="p-4">
        <h2 className="text-[15px] font-semibold tracking-tight">Body metrics</h2>
        <div className="mt-3 space-y-3">
          {quick.map(({ definition, latest }) => (
            <div key={definition.id}>
              <div className="flex items-baseline justify-between">
                <label className="text-[13.5px] font-medium">{definition.label}</label>
                {latest && (
                  <span className="text-[12px] text-ink-muted">
                    {toDisplay(definition.unitType, latest.value)}
                    {unitSuffix(definition.unitType)} ·{' '}
                    {formatRelativeDay(latest.measuredAt)}
                  </span>
                )}
              </div>
              <div className="mt-1 flex gap-2">
                <input
                  value={draftValues[definition.id] ?? ''}
                  onChange={(event) =>
                    setDraftValues((current) => ({
                      ...current,
                      [definition.id]: event.target.value,
                    }))
                  }
                  inputMode="decimal"
                  placeholder={
                    latest
                      ? String(toDisplay(definition.unitType, latest.value))
                      : unitSuffix(definition.unitType)
                  }
                  className="h-11 flex-1 rounded-xl border border-line bg-surface px-3.5 tabular text-[16px] outline-none focus:border-accent"
                />
                <Button
                  variant="secondary"
                  onClick={() => void saveMetric(definition.id, definition.unitType)}
                  disabled={!draftValues[definition.id]?.trim()}
                  aria-label={`Log ${definition.label}`}
                >
                  <Check size={17} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="text-[15px] font-semibold tracking-tight">Units</h2>
        <div className="mt-3 space-y-3">
          <UnitToggle<WeightUnit>
            label="Weight"
            value={profile.unitWeight}
            options={['lb', 'kg']}
            onChange={(unitWeight) => void repo.updateProfile({ unitWeight })}
          />
          <UnitToggle<DistanceUnit>
            label="Distance"
            value={profile.unitDistance}
            options={['mi', 'km']}
            onChange={(unitDistance) => void repo.updateProfile({ unitDistance })}
          />
          <UnitToggle<LengthUnit>
            label="Length"
            value={profile.unitLength}
            options={['in', 'cm']}
            onChange={(unitLength) => void repo.updateProfile({ unitLength })}
          />
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="text-[15px] font-semibold tracking-tight">Logging</h2>
        <div className="mt-3 space-y-3">
          <div>
            <label className="text-[13.5px] font-medium">
              Default rest timer
            </label>
            <div className="mt-1.5 flex gap-1.5">
              {[30, 60, 90, 120, 180].map((seconds) => (
                <button
                  key={seconds}
                  onClick={() => void repo.updateProfile({ defaultRestSeconds: seconds })}
                  className={cn(
                    'h-10 flex-1 rounded-lg text-[13px] font-semibold',
                    profile.defaultRestSeconds === seconds
                      ? 'bg-accent text-white'
                      : 'bg-sunken text-ink-secondary',
                  )}
                >
                  {seconds < 60 ? `${seconds}s` : `${seconds / 60}m`}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center justify-between">
            <span>
              <span className="block text-[13.5px] font-medium">Track RPE</span>
              <span className="block text-[12px] text-ink-muted">
                Adds an effort field to every set
              </span>
            </span>
            <input
              type="checkbox"
              checked={profile.showRpe}
              onChange={(event) =>
                void repo.updateProfile({ showRpe: event.target.checked })
              }
              className="size-5 accent-[var(--accent)]"
            />
          </label>

          <label className="flex items-center justify-between">
            <span>
              <span className="block text-[13.5px] font-medium">
                Start rest automatically
              </span>
              <span className="block text-[12px] text-ink-muted">
                Begin the timer as soon as you log a set
              </span>
            </span>
            <input
              type="checkbox"
              checked={profile.autoStartRest}
              onChange={(event) =>
                void repo.updateProfile({ autoStartRest: event.target.checked })
              }
              className="size-5 accent-[var(--accent)]"
            />
          </label>

          <label className="flex items-center justify-between">
            <span>
              <span className="block text-[13.5px] font-medium">Sounds</span>
              <span className="block text-[12px] text-ink-muted">
                Cues for logging a set, records, and rest
              </span>
            </span>
            <input
              type="checkbox"
              checked={profile.soundEnabled}
              onChange={(event) => {
                setSoundEnabled(event.target.checked)
                void repo.updateProfile({ soundEnabled: event.target.checked })
                // Play the cue being enabled, so the choice is audible.
                if (event.target.checked) playCue('pr')
              }}
              className="size-5 accent-[var(--accent)]"
            />
          </label>
        </div>
      </Card>

      <AppearanceSection
        theme={profile.theme}
        colorScheme={profile.colorScheme}
        accentOverride={profile.accentOverride}
        onChange={(patch) => void repo.updateProfile(patch)}
      />

      <Card className="p-4">
        <h2 className="text-[15px] font-semibold tracking-tight">Data</h2>
        <dl className="mt-2.5 space-y-1.5 text-[13.5px]">
          <div className="flex justify-between">
            <dt className="text-ink-secondary">Workouts logged</dt>
            <dd className="tabular font-semibold">{workoutCount}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-secondary">Queued for sync</dt>
            <dd className="tabular font-semibold">{pendingWrites}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-secondary">Storage</dt>
            <dd className="font-semibold">On this device only</dd>
          </div>
        </dl>
        <p className="mt-2.5 text-[12px] text-ink-muted">
          Data lives in this browser. Sync to a server is not connected yet, but
          every change is already queued for it.
        </p>
      </Card>
    </div>
  )
}

function UnitToggle<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: T[]
  onChange: (value: T) => void
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[13.5px] font-medium">{label}</span>
      <div className="flex gap-1 rounded-lg bg-sunken p-0.5">
        {options.map((option) => (
          <button
            key={option}
            onClick={() => onChange(option)}
            className={cn(
              'h-8 rounded-md px-3.5 text-[13px] font-semibold',
              value === option ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted',
            )}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  )
}
