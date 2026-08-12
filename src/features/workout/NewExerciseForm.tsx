/**
 * Create a custom exercise (§4.3).
 *
 * This is the "I've never done a reverse dumbbell fly and want to add it as a
 * delt exercise so it shows up in workouts and charts" flow. The muscle choice
 * is what wires a new exercise into every chart, so it is required rather than
 * optional — an untagged exercise would silently vanish from every region
 * breakdown.
 */

import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft } from 'lucide-react'
import { db } from '@/db/database'
import * as repo from '@/data/repository'
import { Button } from '@/components/Button'
import { cn } from '@/lib/cn'
import { regionVar } from '@/lib/palette'
import {
  EQUIPMENT,
  REGION_LABELS,
  REGIONS,
  TRACKING_TYPES,
  type Equipment,
  type TrackingType,
} from '@/domain/types'

/** Plain-language labels — the enum values are for the database, not the user. */
const TRACKING_LABELS: Record<TrackingType, string> = {
  weight_reps: 'Weight & reps',
  bodyweight_reps: 'Bodyweight reps',
  weighted_bodyweight: 'Bodyweight + added weight',
  assisted_bodyweight: 'Assisted bodyweight',
  reps_only: 'Reps only',
  time: 'Time only',
  distance_time: 'Distance & time',
  weight_time: 'Weight & time (carries)',
}

const EQUIPMENT_LABELS: Record<Equipment, string> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbell',
  machine: 'Machine',
  cable: 'Cable',
  smith: 'Smith machine',
  bodyweight: 'Bodyweight',
  kettlebell: 'Kettlebell',
  band: 'Band',
  other: 'Other',
}

export function NewExerciseForm({
  initialName = '',
  onCreated,
  onCancel,
}: {
  initialName?: string
  onCreated: (exerciseId: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initialName)
  const [region, setRegion] = useState<string | null>(null)
  const [primaryMuscleId, setPrimaryMuscleId] = useState<string | null>(null)
  const [equipment, setEquipment] = useState<Equipment>('dumbbell')
  const [trackingType, setTrackingType] = useState<TrackingType>('weight_reps')
  const [isUnilateral, setIsUnilateral] = useState(false)
  const [notes, setNotes] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const muscles = useLiveQuery(async () => {
    const all = await db.muscles.toArray()
    return all.filter((m) => m.deletedAt === null && !m.isArchived)
  }, [])

  const musclesInRegion = useMemo(
    () => (muscles ?? []).filter((m) => m.region === region),
    [muscles, region],
  )

  const canSave = name.trim().length > 0 && primaryMuscleId !== null

  async function save() {
    if (!canSave || primaryMuscleId === null) return
    setIsSaving(true)
    try {
      const exerciseId = await repo.createExercise({
        name,
        primaryMuscleId,
        equipment,
        trackingType,
        isUnilateral,
        notes,
      })
      onCreated(exerciseId)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-page">
      <header className="flex items-center gap-2 border-b border-line bg-surface px-2 py-2 pt-safe">
        <button
          onClick={onCancel}
          aria-label="Back"
          className="flex size-10 items-center justify-center rounded-lg text-ink-secondary active:bg-sunken"
        >
          <ChevronLeft size={22} />
        </button>
        <h1 className="flex-1 text-[16px] font-semibold tracking-tight">New exercise</h1>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <Field label="Name">
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Reverse Dumbbell Fly"
            className="h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-[16px] outline-none focus:border-accent"
          />
        </Field>

        <Field
          label="Body part"
          hint="Decides which charts and volume totals this exercise feeds."
        >
          <div className="flex flex-wrap gap-1.5">
            {REGIONS.map((option) => {
              const isActive = region === option
              return (
                <button
                  key={option}
                  onClick={() => {
                    setRegion(option)
                    setPrimaryMuscleId(null)
                  }}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-3 py-2 text-[13.5px] font-medium',
                    isActive
                      ? 'border-transparent text-white'
                      : 'border-line text-ink-secondary',
                  )}
                  style={isActive ? { background: regionVar(option) } : undefined}
                >
                  {!isActive && (
                    <span
                      className="size-2 rounded-full"
                      style={{ background: regionVar(option) }}
                      aria-hidden
                    />
                  )}
                  {REGION_LABELS[option]}
                </button>
              )
            })}
          </div>
        </Field>

        {region && (
          <Field label="Specific muscle">
            <div className="flex flex-wrap gap-1.5">
              {musclesInRegion.map((muscle) => (
                <button
                  key={muscle.id}
                  onClick={() => setPrimaryMuscleId(muscle.id)}
                  className={cn(
                    'rounded-full border px-3 py-2 text-[13.5px] font-medium',
                    primaryMuscleId === muscle.id
                      ? 'border-accent bg-accent-wash text-accent'
                      : 'border-line text-ink-secondary',
                  )}
                >
                  {muscle.name}
                </button>
              ))}
            </div>
          </Field>
        )}

        <Field label="Equipment">
          <ChipGroup
            options={EQUIPMENT.map((value) => ({
              value,
              label: EQUIPMENT_LABELS[value],
            }))}
            value={equipment}
            onChange={setEquipment}
          />
        </Field>

        <Field label="How it's tracked" hint="Decides which inputs the set row shows.">
          <ChipGroup
            options={TRACKING_TYPES.map((value) => ({
              value,
              label: TRACKING_LABELS[value],
            }))}
            value={trackingType}
            onChange={setTrackingType}
          />
        </Field>

        <label className="flex items-center justify-between rounded-xl border border-line bg-surface px-3.5 py-3">
          <span>
            <span className="block text-[15px] font-medium">One side at a time</span>
            <span className="block text-[12.5px] text-ink-muted">
              Tracks left and right separately
            </span>
          </span>
          <input
            type="checkbox"
            checked={isUnilateral}
            onChange={(event) => setIsUnilateral(event.target.checked)}
            className="size-5 accent-[var(--accent)]"
          />
        </label>

        <Field label="Notes" hint="Seat height, pin setting, cues.">
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={2}
            className="w-full resize-none rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[15px] outline-none focus:border-accent"
          />
        </Field>
      </div>

      <div className="border-t border-line bg-surface px-3 py-2.5 pb-safe">
        <Button
          size="lg"
          className="w-full"
          disabled={!canSave || isSaving}
          onClick={() => void save()}
        >
          {primaryMuscleId === null ? 'Pick a muscle to continue' : 'Create exercise'}
        </Button>
      </div>
    </div>
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
      <p className="mb-1.5 text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      {hint && <p className="mb-2 -mt-0.5 text-[12.5px] text-ink-muted">{hint}</p>}
      {children}
    </div>
  )
}

function ChipGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-full border px-3 py-2 text-[13.5px] font-medium',
            value === option.value
              ? 'border-accent bg-accent-wash text-accent'
              : 'border-line text-ink-secondary',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
