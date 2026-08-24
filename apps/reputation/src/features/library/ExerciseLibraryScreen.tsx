import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, Plus, Search, X } from 'lucide-react'
import * as repo from '@/data/repository'
import { Card } from '@/components/Card'
import { cn } from '@/lib/cn'
import { ExerciseFilterPills } from '@/components/ExerciseFilterPills'
import { MovementList } from '@/components/MovementList'
import { type Region } from '@/domain/types'
import { NewExerciseForm } from '@/features/workout/NewExerciseForm'
import { ExerciseDetailSheet } from '@/features/workout/ExerciseDetailSheet'

type SortMode = 'name' | 'recent'

export function ExerciseLibraryScreen({ onBack }: { onBack?: () => void }) {
  const [query, setQuery] = useState('')
  const [regionFilter, setRegionFilter] = useState<Region | null>(null)
  const [sort, setSort] = useState<SortMode>('name')
  const [isCreating, setIsCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [detailFor, setDetailFor] = useState<string | null>(null)

  const data = useLiveQuery(async () => {
    const exercises = await repo.listExercises()
    const profile = await repo.getProfile()
    return {
      exercises,
      lastTrained: await repo.getLastTrainedMap(),
      profile,
    }
  }, [])

  const results = useMemo(() => {
    if (!data) return []
    const normalized = query.trim().toLowerCase()

    let list = data.exercises

    if (regionFilter !== null) {
      list = list.filter((e) => e.region === regionFilter)
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
  }, [data, query, regionFilter, sort])

  const editingExercise = data?.exercises.find((e) => e.id === editingId)

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

  if (editingExercise) {
    return (
      <NewExerciseForm
        exercise={editingExercise}
        onCreated={(exerciseId) => {
          setEditingId(null)
          // A system row forks to a new id; follow the fork.
          setDetailFor(exerciseId)
        }}
        onCancel={() => setEditingId(null)}
      />
    )
  }

  const hasFilters = regionFilter !== null
  const movementCount = results.length

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line bg-surface px-3 pb-2 pt-2">
        {/* Every other destination off More has a titled header; without one this
            read as a stray search box with no way back. */}
        <div className="mb-2 flex items-center gap-1">
          {onBack && (
            <button
              onClick={onBack}
              aria-label="Back"
              className="-ml-2 flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-secondary active:bg-sunken"
            >
              <ChevronLeft size={22} />
            </button>
          )}
          <h1 className="flex-1 text-[16px] font-semibold tracking-tight">
            Exercise library
          </h1>
        </div>
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
      </div>

      <ExerciseFilterPills
        region={regionFilter}
        onRegionChange={setRegionFilter}
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

        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <span className="text-[12px] text-ink-muted">
            {movementCount} {movementCount === 1 ? 'movement' : 'movements'}
            {hasFilters && (
              <button
                onClick={() => setRegionFilter(null)}
                className="ml-2 font-semibold text-accent"
              >
                Clear
              </button>
            )}
          </span>
          <div className="flex gap-0.5 rounded-lg bg-sunken p-0.5 text-[12px] font-semibold">
            {(['name', 'recent'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setSort(mode)}
                className={cn(
                  'rounded-md px-2.5 py-1',
                  sort === mode ? 'bg-surface text-ink shadow-sm' : 'text-ink-secondary',
                )}
              >
                {mode === 'name' ? 'A–Z' : 'Recent'}
              </button>
            ))}
          </div>
        </div>

        <Card className="overflow-hidden">
          {data && (
            <MovementList
              exercises={results}
              lastTrained={data.lastTrained}
              onChoose={setDetailFor}
            />
          )}

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
          onEdit={() => {
            setEditingId(detailFor)
            setDetailFor(null)
          }}
          onDismiss={() => setDetailFor(null)}
        />
      )}
    </div>
  )
}
