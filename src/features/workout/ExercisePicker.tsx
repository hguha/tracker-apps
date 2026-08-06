/**
 * Exercise search and creation (§4.3).
 *
 * Search matches aliases as well as names, so "OHP" finds Overhead Press and
 * "reverse chest fly" finds Reverse Dumbbell Fly. Recently-used exercises come
 * first when the query is empty, because the next exercise is usually one of
 * the handful trained regularly.
 */

import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, Search, X } from 'lucide-react'
import { db } from '@/db/database'
import * as repo from '@/data/repository'
import { cn } from '@/lib/cn'
import { regionVar } from '@/lib/palette'
import { EQUIPMENT, REGION_LABELS, REGIONS } from '@/domain/types'
import { NewExerciseForm } from './NewExerciseForm'

/** Title-cases an equipment/pattern enum value: `smith` → `Smith`. */
function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function ExercisePicker({
  onPick,
  onDismiss,
}: {
  onPick: (exerciseId: string) => void
  onDismiss: () => void
}) {
  const [query, setQuery] = useState('')
  const [regionFilter, setRegionFilter] = useState<string | null>(null)
  const [equipmentFilter, setEquipmentFilter] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  const data = useLiveQuery(async () => {
    const exercises = await repo.listExercises()
    const muscles = await db.muscles.toArray()
    const muscleById = new Map(muscles.map((m) => [m.id, m]))

    // Rank by how recently each exercise was performed.
    const recent = await db.workouts.orderBy('startedAt').reverse().limit(30).toArray()
    const recencyByExerciseId = new Map<string, number>()
    for (const workout of recent) {
      const workoutExercises = await repo.listWorkoutExercises(workout.id)
      for (const we of workoutExercises) {
        if (!recencyByExerciseId.has(we.exerciseId)) {
          recencyByExerciseId.set(we.exerciseId, workout.startedAt)
        }
      }
    }

    return { exercises, muscleById, recencyByExerciseId }
  }, [])

  const results = useMemo(() => {
    if (!data) return []
    const normalized = query.trim().toLowerCase()

    let list = data.exercises
    if (regionFilter) {
      list = list.filter(
        (e) => data.muscleById.get(e.primaryMuscleId)?.region === regionFilter,
      )
    }
    if (equipmentFilter) {
      list = list.filter((e) => e.equipment === equipmentFilter)
    }

    if (normalized === '') {
      return [...list].sort((a, b) => {
        const aRecency = data.recencyByExerciseId.get(a.id) ?? 0
        const bRecency = data.recencyByExerciseId.get(b.id) ?? 0
        if (aRecency !== bRecency) return bRecency - aRecency
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
  }, [data, query, regionFilter, equipmentFilter])

  if (isCreating) {
    return (
      <NewExerciseForm
        initialName={query.trim()}
        onCreated={(exerciseId) => onPick(exerciseId)}
        onCancel={() => setIsCreating(false)}
      />
    )
  }

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

      {/* Region filter chips, colored with the fixed region palette. */}
      <div className="flex gap-1.5 overflow-x-auto border-b border-line bg-surface px-3 py-2">
        {REGIONS.map((region) => {
          const isActive = regionFilter === region
          return (
            <button
              key={region}
              onClick={() => setRegionFilter(isActive ? null : region)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium',
                isActive ? 'border-transparent text-white' : 'border-line text-ink-secondary',
              )}
              style={isActive ? { background: regionVar(region) } : undefined}
            >
              {!isActive && (
                <span
                  className="size-2 rounded-full"
                  style={{ background: regionVar(region) }}
                  aria-hidden
                />
              )}
              {REGION_LABELS[region]}
            </button>
          )
        })}
      </div>

      {/* Equipment filter chips — a second axis alongside body part. */}
      <div className="flex gap-1.5 overflow-x-auto border-b border-line bg-surface px-3 py-2">
        {EQUIPMENT.map((equipment) => {
          const isActive = equipmentFilter === equipment
          return (
            <button
              key={equipment}
              onClick={() => setEquipmentFilter(isActive ? null : equipment)}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1.5 text-[13px] font-medium',
                isActive
                  ? 'border-accent bg-accent-wash text-accent'
                  : 'border-line text-ink-secondary',
              )}
            >
              {titleCase(equipment)}
            </button>
          )
        })}
      </div>

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

        {results.map((exercise) => {
          const muscle = data?.muscleById.get(exercise.primaryMuscleId)
          return (
            <button
              key={exercise.id}
              onClick={() => onPick(exercise.id)}
              className="flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left active:bg-accent-wash"
            >
              {muscle && (
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: regionVar(muscle.region) }}
                  aria-hidden
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">
                  {exercise.name}
                </span>
                <span className="block truncate text-[12.5px] text-ink-muted">
                  {muscle?.name} · {exercise.equipment.replace(/_/g, ' ')}
                </span>
              </span>
              {exercise.userId !== null && (
                <span className="shrink-0 rounded-full bg-sunken px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted">
                  Custom
                </span>
              )}
            </button>
          )
        })}

        {results.length === 0 && query.trim() !== '' && (
          <p className="px-4 py-8 text-center text-[14px] text-ink-muted">
            No exercise matches "{query.trim()}".
          </p>
        )}
      </div>
    </div>
  )
}
