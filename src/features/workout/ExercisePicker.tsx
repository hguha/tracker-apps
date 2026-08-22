import { useMemo, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, Search, X } from 'lucide-react'
import * as repo from '@/data/repository'
import { BottomSheet } from '@/components/BottomSheet'
import { ExerciseFilterPills } from '@/components/ExerciseFilterPills'
import { MovementList } from '@/components/MovementList'
import { cn } from '@/lib/cn'
import { humanizeSlug } from '@/lib/labels'
import {
  defaultEquipmentForTracking,
  defaultLoadModeForTracking,
  EQUIPMENT,
  equipmentIsChosen,
  LOAD_MODES,
  LOAD_MODE_LABELS,
  loadModeIsChosen,
  type Equipment,
  type LoadMode,
  type Region,
  type WeightUnit,
} from '@/domain/types'
import { parseNumber, weightToKg } from '@/lib/units'
import { NewExerciseForm } from './NewExerciseForm'

type SortMode = 'name' | 'recent'

export function ExercisePicker({
  onPick,
  onDismiss,
}: {
  onPick: (exerciseId: string, equipment: Equipment, loadMode: LoadMode | null) => void
  onDismiss: () => void
}) {
  const [query, setQuery] = useState('')
  const [regionFilter, setRegionFilter] = useState<Region | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  // Recency first: adding an exercise is nearly always one you train already.
  const [sort, setSort] = useState<SortMode>('recent')
  // Once a movement is chosen, the mandatory equipment step takes over.
  const [chosenId, setChosenId] = useState<string | null>(null)

  const data = useLiveQuery(async () => {
    const exercises = await repo.listExercises()

    const recent = await repo.listWorkouts(30)
    // The equipment / load mode last used for each movement, to pre-highlight it.
    const lastEquipmentByExerciseId = new Map<string, Equipment>()
    const lastLoadModeByExerciseId = new Map<string, LoadMode>()
    for (const workout of recent) {
      for (const we of await repo.listWorkoutExercises(workout.id)) {
        if (!lastEquipmentByExerciseId.has(we.exerciseId)) {
          lastEquipmentByExerciseId.set(we.exerciseId, we.equipment)
        }
        if (we.loadMode !== null && !lastLoadModeByExerciseId.has(we.exerciseId)) {
          lastLoadModeByExerciseId.set(we.exerciseId, we.loadMode)
        }
      }
    }

    const profile = await repo.getProfile()
    // Same source as the library's, so "last trained" can't disagree between them.
    return {
      exercises,
      lastTrained: await repo.getLastTrainedMap(),
      lastEquipmentByExerciseId,
      lastLoadModeByExerciseId,
      bodyweightKg: profile.bodyweightCacheKg,
      unitWeight: profile.unitWeight,
    }
  }, [])

  const results = useMemo(() => {
    if (!data) return []
    const normalized = query.trim().toLowerCase()

    let list = data.exercises
    if (regionFilter) {
      list = list.filter((e) => e.region === regionFilter)
    }

    if (normalized === '') {
      return [...list].sort((a, b) => {
        if (sort === 'recent') {
          const aAt = data.lastTrained.get(a.id) ?? 0
          const bAt = data.lastTrained.get(b.id) ?? 0
          if (aAt !== bAt) return bAt - aAt
        }
        return a.name.localeCompare(b.name)
      })
    }

    return list
      .map((exercise) => {
        const name = exercise.name.toLowerCase()
        const aliasHit = exercise.aliases.some((alias) =>
          alias.toLowerCase().includes(normalized),
        )
        // Prefix matches rank above substring matches, which rank above aliases.
        let score = -1
        if (name.startsWith(normalized)) score = 0
        else if (name.includes(normalized)) score = 1
        else if (aliasHit) score = 2
        return { exercise, score }
      })
      .filter((r) => r.score >= 0)
      .sort((a, b) => a.score - b.score || a.exercise.name.localeCompare(b.exercise.name))
      .map((r) => r.exercise)
  }, [data, query, regionFilter, sort])

  // Loaded lifts get the equipment step and bodyweight lifts the load-mode step;
  // everything else (cardio, reps-only) has a fixed implement and no mode, so it's
  // added straight away.
  function chooseExercise(exerciseId: string) {
    const exercise = data?.exercises.find((e) => e.id === exerciseId)
    if (!exercise) return
    if (
      equipmentIsChosen(exercise.trackingType) ||
      loadModeIsChosen(exercise.trackingType)
    ) {
      setChosenId(exerciseId)
    } else {
      onPick(
        exerciseId,
        defaultEquipmentForTracking(exercise.trackingType),
        defaultLoadModeForTracking(exercise.trackingType),
      )
    }
  }

  if (isCreating) {
    return (
      <NewExerciseForm
        initialName={query.trim()}
        onCreated={(exerciseId) => {
          setIsCreating(false)
          chooseExercise(exerciseId)
        }}
        onCancel={() => setIsCreating(false)}
      />
    )
  }

  const chosen = chosenId ? data?.exercises.find((e) => e.id === chosenId) : undefined

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-page">
      <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2 pt-safe">
        <div className="flex h-11 flex-1 items-center gap-2 rounded-xl bg-sunken px-3">
          <Search size={17} className="shrink-0 text-ink-muted" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search exercises"
            className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-ink-muted"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear search">
              <X size={17} className="text-ink-muted" />
            </button>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="h-11 px-2 text-[15px] font-semibold text-accent"
        >
          Cancel
        </button>
      </div>

      <ExerciseFilterPills
        region={regionFilter}
        onRegionChange={setRegionFilter}
        className="border-b border-line bg-surface"
      />

      <div className="flex-1 overflow-y-auto">
        <button
          onClick={() => setIsCreating(true)}
          className="flex w-full items-center gap-2.5 border-b border-line px-4 py-3 text-left active:bg-accent-wash"
        >
          <span className="flex size-9 items-center justify-center rounded-full bg-accent-wash text-accent">
            <Plus size={18} />
          </span>
          <span className="text-[15px] font-semibold text-accent">
            {query.trim() ? `Create "${query.trim()}"` : 'Create a new exercise'}
          </span>
        </button>

        {/* Only meaningful while browsing: a search is already ranked by match. */}
        {query.trim() === '' && (
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
            <span className="text-[12px] text-ink-muted">
              {results.length} {results.length === 1 ? 'movement' : 'movements'}
            </span>
            <div className="flex gap-0.5 rounded-lg bg-sunken p-0.5 text-[12px] font-semibold">
              {(['recent', 'name'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setSort(mode)}
                  className={cn(
                    'rounded-md px-2.5 py-1',
                    sort === mode
                      ? 'bg-surface text-ink shadow-sm'
                      : 'text-ink-secondary',
                  )}
                >
                  {mode === 'name' ? 'A–Z' : 'Recent'}
                </button>
              ))}
            </div>
          </div>
        )}

        {data && (
          <MovementList
            exercises={results}
            lastTrained={data.lastTrained}
            onChoose={chooseExercise}
          />
        )}

        {results.length === 0 && query.trim() !== '' && (
          <p className="px-4 py-8 text-center text-[14px] text-ink-muted">
            No exercise matches "{query.trim()}".
          </p>
        )}
      </div>

      {chosen && loadModeIsChosen(chosen.trackingType) && (
        <LoadModeSheet
          exerciseName={chosen.name}
          lastUsed={data?.lastLoadModeByExerciseId.get(chosen.id) ?? null}
          bodyweightKg={data?.bodyweightKg ?? null}
          unitWeight={data?.unitWeight ?? 'lb'}
          onPick={(loadMode) =>
            onPick(chosen.id, defaultEquipmentForTracking(chosen.trackingType), loadMode)
          }
          onDismiss={() => setChosenId(null)}
        />
      )}

      {chosen && equipmentIsChosen(chosen.trackingType) && (
        <EquipmentSheet
          exerciseName={chosen.name}
          lastUsed={data?.lastEquipmentByExerciseId.get(chosen.id) ?? null}
          onPick={(equipment) => onPick(chosen.id, equipment, null)}
          onDismiss={() => setChosenId(null)}
        />
      )}
    </div>
  )
}

// The "how is it loaded?" step, as a sheet over the list: you've picked a
// movement, now choose from a grid with the option you used last time pulled to
// the front and marked. Backs both the equipment and load-mode choices; `footer`
// is where the load-mode sheet slots its bodyweight capture.
function ChoiceGridSheet<T extends string>({
  exerciseName,
  options,
  lastUsed,
  labelOf,
  onPick,
  onDismiss,
  footer,
}: {
  exerciseName: string
  options: readonly T[]
  lastUsed: T | null
  labelOf: (option: T) => string
  onPick: (option: T) => void
  onDismiss: () => void
  footer?: ReactNode
}) {
  const ordered = lastUsed ? [lastUsed, ...options.filter((o) => o !== lastUsed)] : options

  return (
    <BottomSheet onDismiss={onDismiss} panelClassName="px-5">
      <div className="flex items-center justify-center pt-2.5 pb-1">
        <span className="h-1 w-9 rounded-full bg-line-strong" aria-hidden />
      </div>
      <div className="pb-3 pt-1.5">
        <h2 className="text-[17px] font-bold tracking-tight">{exerciseName}</h2>
        <p className="text-[12.5px] text-ink-muted">How are you loading it?</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {ordered.map((option) => {
          const isLast = option === lastUsed
          return (
            <button
              key={option}
              onClick={() => onPick(option)}
              className={cn(
                'flex h-16 flex-col items-center justify-center gap-1 rounded-2xl border text-[13px] font-semibold active:scale-[0.97]',
                isLast
                  ? 'border-accent bg-accent-wash text-accent'
                  : 'border-line bg-sunken text-ink-secondary',
              )}
            >
              {labelOf(option)}
              {isLast && (
                <span className="text-[10px] font-medium uppercase tracking-wide text-accent/80">
                  Last used
                </span>
              )}
            </button>
          )
        })}
      </div>

      {footer}

      {/* Breathing room below; the panel itself only carries safe-area pad. */}
      <div className="h-8" />
    </BottomSheet>
  )
}

function EquipmentSheet({
  exerciseName,
  lastUsed,
  onPick,
  onDismiss,
}: {
  exerciseName: string
  lastUsed: Equipment | null
  onPick: (equipment: Equipment) => void
  onDismiss: () => void
}) {
  return (
    <ChoiceGridSheet
      exerciseName={exerciseName}
      options={EQUIPMENT}
      lastUsed={lastUsed}
      labelOf={humanizeSlug}
      onPick={onPick}
      onDismiss={onDismiss}
    />
  )
}

// Bodyweight / weighted (+) / assisted (−). Because volume for these needs a
// bodyweight to scale by, it captures one inline the first time it's missing.
function LoadModeSheet({
  exerciseName,
  lastUsed,
  bodyweightKg,
  unitWeight,
  onPick,
  onDismiss,
}: {
  exerciseName: string
  lastUsed: LoadMode | null
  bodyweightKg: number | null
  unitWeight: WeightUnit
  onPick: (loadMode: LoadMode) => void
  onDismiss: () => void
}) {
  const [bodyweight, setBodyweight] = useState('')
  const needsBodyweight = bodyweightKg === null

  async function pick(mode: LoadMode) {
    // Capture the bodyweight the volume math needs, if we don't have one yet.
    if (needsBodyweight) {
      const value = parseNumber(bodyweight)
      if (value !== null && value > 0) {
        await repo.addMetricEntry({
          definitionId: 'bodyweight',
          value: weightToKg(value, unitWeight),
        })
      }
    }
    onPick(mode)
  }

  return (
    <ChoiceGridSheet
      exerciseName={exerciseName}
      options={LOAD_MODES}
      lastUsed={lastUsed}
      labelOf={(mode) => LOAD_MODE_LABELS[mode]}
      onPick={(mode) => void pick(mode)}
      onDismiss={onDismiss}
      footer={
        needsBodyweight ? (
          <div className="mt-4">
            <label className="text-[12.5px] font-medium text-ink-secondary">
              Your bodyweight ({unitWeight}) — needed to track this
            </label>
            <input
              value={bodyweight}
              onChange={(event) => setBodyweight(event.target.value)}
              inputMode="decimal"
              placeholder={unitWeight === 'kg' ? '75' : '165'}
              className="mt-1.5 h-11 w-full rounded-xl border border-line bg-sunken px-3.5 text-[16px] outline-none focus:border-accent focus:bg-surface"
            />
          </div>
        ) : undefined
      }
    />
  )
}
