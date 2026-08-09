/**
 * The exercise library (§7.3) — browsable any time, not only while adding an
 * exercise mid-workout.
 *
 * Search covers names and aliases; filters cover region, equipment, and pattern.
 * All three filters live behind summary chips rather than inline pill rows, which
 * is what keeps the header a fixed height as the library grows past 200 rows.
 */

import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight, Plus, Search, SlidersHorizontal, X } from 'lucide-react'
import { db } from '@/db/database'
import * as repo from '@/data/repository'
import { Card } from '@/components/Card'
import { FilterSheet } from '@/components/FilterSheet'
import { cn } from '@/lib/cn'
import { formatRelativeDay } from '@/lib/dates'
import { regionVar } from '@/lib/palette'
import {
  EQUIPMENT,
  MOVEMENT_PATTERNS,
  REGION_LABELS,
  REGIONS,
  type Region,
} from '@/domain/types'
import { titleCase } from '@/features/workout/ExerciseDetailSheet'
import { NewExerciseForm } from '@/features/workout/NewExerciseForm'
import { ExerciseDetailSheet } from '@/features/workout/ExerciseDetailSheet'

type SortMode = 'name' | 'recent'

export function ExerciseLibraryScreen() {
  const [query, setQuery] = useState('')
  const [regionFilter, setRegionFilter] = useState<string[]>([])
  const [equipmentFilter, setEquipmentFilter] = useState<string[]>([])
  const [patternFilter, setPatternFilter] = useState<string[]>([])
  const [sort, setSort] = useState<SortMode>('name')
  const [openSheet, setOpenSheet] = useState<'region' | 'equipment' | 'pattern' | null>(
    null,
  )
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

    if (regionFilter.length > 0) {
      list = list.filter((e) => {
        const region = data.muscleById.get(e.primaryMuscleId)?.region
        return region !== undefined && regionFilter.includes(region)
      })
    }
    if (equipmentFilter.length > 0) {
      list = list.filter((e) => equipmentFilter.includes(e.equipment))
    }
    if (patternFilter.length > 0) {
      list = list.filter((e) => patternFilter.includes(e.movementPattern))
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
  }, [data, query, regionFilter, equipmentFilter, patternFilter, sort])

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

  const activeFilterCount =
    regionFilter.length + equipmentFilter.length + patternFilter.length

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

        {/* Summary chips. Fixed height regardless of how many options exist. */}
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
          <FilterChip
            label={summarize(
              'Body part',
              regionFilter,
              (v) => REGION_LABELS[v as Region],
            )}
            isActive={regionFilter.length > 0}
            onClick={() => setOpenSheet('region')}
          />
          <FilterChip
            label={summarize('Equipment', equipmentFilter, titleCase)}
            isActive={equipmentFilter.length > 0}
            onClick={() => setOpenSheet('equipment')}
          />
          <FilterChip
            label={summarize('Pattern', patternFilter, titleCase)}
            isActive={patternFilter.length > 0}
            onClick={() => setOpenSheet('pattern')}
          />
          <button
            onClick={() => setSort(sort === 'name' ? 'recent' : 'name')}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[13px] font-medium text-ink-secondary"
          >
            <SlidersHorizontal size={13} />
            {sort === 'name' ? 'A–Z' : 'Recent'}
          </button>
          {activeFilterCount > 0 && (
            <button
              onClick={() => {
                setRegionFilter([])
                setEquipmentFilter([])
                setPatternFilter([])
              }}
              className="shrink-0 px-2 text-[13px] font-semibold text-accent"
            >
              Clear
            </button>
          )}
        </div>
      </div>

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
                    {muscle?.name} · {titleCase(exercise.equipment)}
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

      {openSheet === 'region' && (
        <FilterSheet
          title="Body part"
          options={REGIONS.map((region) => ({
            value: region,
            label: REGION_LABELS[region],
            swatch: regionVar(region),
          }))}
          selected={regionFilter}
          onChange={setRegionFilter}
          onDismiss={() => setOpenSheet(null)}
        />
      )}
      {openSheet === 'equipment' && (
        <FilterSheet
          title="Equipment"
          options={EQUIPMENT.map((value) => ({ value, label: titleCase(value) }))}
          selected={equipmentFilter}
          onChange={setEquipmentFilter}
          onDismiss={() => setOpenSheet(null)}
        />
      )}
      {openSheet === 'pattern' && (
        <FilterSheet
          title="Movement pattern"
          options={MOVEMENT_PATTERNS.map((value) => ({
            value,
            label: titleCase(value),
          }))}
          selected={patternFilter}
          onChange={setPatternFilter}
          onDismiss={() => setOpenSheet(null)}
        />
      )}

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

/** "Body part" / "Chest" / "3 body parts" — the chip never grows with the data. */
function summarize(
  noun: string,
  selected: string[],
  labelOf: (value: string) => string,
): string {
  if (selected.length === 0) return noun
  if (selected.length === 1) return labelOf(selected[0]!)
  return `${selected.length} ${noun.toLowerCase()}s`
}

function FilterChip({
  label,
  isActive,
  onClick,
}: {
  label: string
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-full border px-3 py-1.5 text-[13px] font-medium',
        isActive
          ? 'border-accent bg-accent-wash text-accent'
          : 'border-line text-ink-secondary',
      )}
    >
      {label} ▾
    </button>
  )
}
