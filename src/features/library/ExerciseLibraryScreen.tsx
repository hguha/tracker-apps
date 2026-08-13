import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight, Plus, Search, SlidersHorizontal, X } from 'lucide-react'
import { db } from '@/db/database'
import * as repo from '@/data/repository'
import { Card } from '@/components/Card'
import { ExerciseFilterPills } from '@/components/ExerciseFilterPills'
import { cn } from '@/lib/cn'
import { formatRelativeDay } from '@/lib/dates'
import { regionVar } from '@/lib/palette'
import { type Region } from '@/domain/types'
import { NewExerciseForm } from '@/features/workout/NewExerciseForm'
import { ExerciseDetailSheet } from '@/features/workout/ExerciseDetailSheet'
import { humanizeSlug } from '@/lib/labels'

type SortMode = 'name' | 'recent'

export function ExerciseLibraryScreen() {
  const [query, setQuery] = useState('')
  const [regionFilter, setRegionFilter] = useState<Region | null>(null)
  const [equipmentFilter, setEquipmentFilter] = useState<string | null>(null)
  const [sort, setSort] = useState<SortMode>('name')
  const [isCreating, setIsCreating] = useState(false)
  const [detailFor, setDetailFor] = useState<string | null>(null)

  const data = useLiveQuery(async () => {
    const exercises = await repo.listExercises()
    const muscles = await db.muscles.toArray()
    const profile = await repo.getProfile()
    return {
      exercises,
      muscleById: new Map(muscles.map((m) => [m.id, m])),
      lastTrained: await repo.getLastTrainedMap(),
      profile,
    }
  }, [])

  const results = useMemo(() => {
    if (!data) return []
    const normalized = query.trim().toLowerCase()

    let list = data.exercises

    if (regionFilter !== null) {
      list = list.filter(
        (e) => data.muscleById.get(e.primaryMuscleId)?.region === regionFilter,
      )
    }
    if (equipmentFilter !== null) {
      list = list.filter((e) => e.equipment === equipmentFilter)
    }

    if (normalized) {
      list = list.filter(
        (e) =>
          e.name.toLowerCase().includes(normalized) ||
          e.aliases.some((a) => a.toLowerCase().includes(normalized)),
      )
    }

    return [...list].sort((a, b) => {
      if (sort === 'recent') {
        const aAt = data.lastTrained.get(a.id) ?? 0
        const bAt = data.lastTrained.get(b.id) ?? 0
        if (aAt !== bAt) return bAt - aAt
      }
      return a.name.localeCompare(b.name)
    })
  }, [data, query, regionFilter, equipmentFilter, sort])

  if (isCreating) {
    return (
      <NewExerciseForm
        initialName={query.trim()}
        onCreated={(exerciseId) => {
          setIsCreating(false)
          setDetailFor(exerciseId)
        }}
        onCancel={() => setIsCreating(false)}
      />
    )
  }

  const hasFilters = regionFilter !== null || equipmentFilter !== null

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line bg-surface px-3 pb-2 pt-2">
        <div className="flex h-11 items-center gap-2 rounded-xl bg-sunken px-3">
          <Search size={17} className="shrink-0 text-ink-muted" />
          <input
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

        <div className="mt-2 flex items-center gap-1.5">
          <button
            onClick={() => setSort(sort === 'name' ? 'recent' : 'name')}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[13px] font-medium text-ink-secondary"
          >
            <SlidersHorizontal size={13} />
            {sort === 'name' ? 'A–Z' : 'Recent'}
          </button>
          {hasFilters && (
            <button
              onClick={() => {
                setRegionFilter(null)
                setEquipmentFilter(null)
              }}
              className="shrink-0 px-2 text-[13px] font-semibold text-accent"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      <ExerciseFilterPills
        region={regionFilter}
        equipment={equipmentFilter}
        onRegionChange={setRegionFilter}
        onEquipmentChange={setEquipmentFilter}
        className="border-b border-line bg-surface"
      />

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <button
          onClick={() => setIsCreating(true)}
          className="mb-2.5 flex w-full items-center gap-2.5 rounded-2xl border border-dashed border-line-strong px-4 py-3 text-left active:bg-accent-wash"
        >
          <span className="flex size-9 items-center justify-center rounded-full bg-accent-wash text-accent">
            <Plus size={18} />
          </span>
          <span className="text-[15px] font-semibold text-accent">
            {query.trim() ? `Create "${query.trim()}"` : 'Create a new exercise'}
          </span>
        </button>

        <p className="mb-2 px-1 text-[12px] text-ink-muted">
          {results.length} {results.length === 1 ? 'exercise' : 'exercises'}
        </p>

        <Card className="overflow-hidden">
          {results.map((exercise, index) => {
            const muscle = data?.muscleById.get(exercise.primaryMuscleId)
            const lastAt = data?.lastTrained.get(exercise.id)
            return (
              <button
                key={exercise.id}
                onClick={() => setDetailFor(exercise.id)}
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-3 text-left active:bg-accent-wash',
                  index > 0 && 'border-t border-line',
                )}
              >
                {muscle && (
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: regionVar(muscle.region) }}
                    aria-hidden
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[15px] font-medium">
                      {exercise.name}
                    </span>
                  </span>
                  <span className="block truncate text-[12.5px] text-ink-muted">
                    {muscle?.name} · {humanizeSlug(exercise.equipment)}
                    {lastAt ? ` · ${formatRelativeDay(lastAt)}` : ''}
                  </span>
                </span>
                {exercise.userId !== null && (
                  <span className="shrink-0 rounded-full bg-sunken px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                    Custom
                  </span>
                )}
                <ChevronRight size={16} className="shrink-0 text-ink-muted" />
              </button>
            )
          })}

          {results.length === 0 && (
            <p className="px-4 py-8 text-center text-[14px] text-ink-muted">
              Nothing matches those filters.
            </p>
          )}
        </Card>
        <div className="h-4" />
      </div>

      {detailFor && data && (
        <ExerciseDetailSheet
          exerciseId={detailFor}
          weightUnit={data.profile.unitWeight}
          distanceUnit={data.profile.unitDistance}
          onDismiss={() => setDetailFor(null)}
        />
      )}
    </div>
  )
}
