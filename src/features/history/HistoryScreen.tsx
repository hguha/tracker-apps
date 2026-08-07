/**
 * History (§5.2). Every entry is editable, copyable, and saveable as a template
 * (§7.1, §7.2) — the moment someone decides a session is worth repeating is not
 * predictable, so those actions have to be reachable from the list itself rather
 * than only from the finish sheet.
 */

import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  CalendarDays,
  ChevronRight,
  Copy,
  FileText,
  List,
  MoreHorizontal,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { format } from 'date-fns'
import * as repo from '@/data/repository'
import { BottomSheet } from '@/components/BottomSheet'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { FilterChipButton, FilterSheet } from '@/components/FilterSheet'
import { useToast } from '@/components/Toast'
import { dayStart, formatDayHeading, formatTimeOfDay } from '@/lib/dates'
import { formatDisplayWeight, formatDuration } from '@/lib/units'
import { regionVar } from '@/lib/palette'
import { cn } from '@/lib/cn'
import { HistoryCalendar } from './HistoryCalendar'
import { WorkoutPreviewSheet } from '@/features/workout/WorkoutPreviewSheet'
import { REGION_LABELS, REGIONS, type Region } from '@/domain/types'

/** How many rows to show at once; "Show more" reveals another page. Keeps the
 *  DOM small on a huge history without a full virtualization dependency. */
const PAGE_SIZE = 30

export function HistoryScreen({
  onOpenWorkout,
  onStartedCopy,
}: {
  onOpenWorkout: (workoutId: string) => void
  onStartedCopy: (workoutId: string) => void
}) {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'list' | 'calendar'>('list')
  const [regionFilter, setRegionFilter] = useState<string[]>([])
  const [exerciseFilter, setExerciseFilter] = useState<string[]>([])
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const [openSheet, setOpenSheet] = useState<'region' | 'exercise' | null>(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [previewFor, setPreviewFor] = useState<string | null>(null)
  const [templateFor, setTemplateFor] = useState<{
    id: string
    name: string
  } | null>(null)

  // One shared summary builder, so History, Home, and the start screen can never
  // disagree about what a session contained (§5.2.1). Pull more here since the
  // list is now searchable — the search should reach well back, not just 100.
  const data = useLiveQuery(
    async () => ({
      profile: await repo.getProfile(),
      summaries: await repo.listWorkoutSummaries(500),
    }),
    [],
  )

  // The exercise picker's options: every distinct lift in the loaded history,
  // alphabetized. Built from summaries so it needs no extra query.
  const exerciseOptions = useMemo(() => {
    const names = new Map<string, string>()
    for (const s of data?.summaries ?? []) {
      s.exerciseIds.forEach((id, i) => {
        if (!names.has(id)) names.set(id, s.exerciseNames[i] ?? 'Exercise')
      })
    }
    return [...names.entries()]
      .map(([id, name]) => ({ value: id, label: name }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [data])

  // Apply text search, body-part, exercise, and day filters together. Computed
  // before the early returns so the hook order stays stable.
  const filtered = useMemo(() => {
    const summaries = data?.summaries ?? []
    const q = query.trim().toLowerCase()
    return summaries.filter((s) => {
      if (
        q &&
        !s.title.toLowerCase().includes(q) &&
        !s.exerciseNames.some((name) => name.toLowerCase().includes(q))
      ) {
        return false
      }
      if (regionFilter.length > 0 && !s.regions.some((r) => regionFilter.includes(r))) {
        return false
      }
      if (
        exerciseFilter.length > 0 &&
        !s.exerciseIds.some((id) => exerciseFilter.includes(id))
      ) {
        return false
      }
      if (selectedDay !== null && dayStart(s.workout.startedAt) !== selectedDay) {
        return false
      }
      return true
    })
  }, [data, query, regionFilter, exerciseFilter, selectedDay])

  const hasFilters =
    query.trim() !== '' ||
    regionFilter.length > 0 ||
    exerciseFilter.length > 0 ||
    selectedDay !== null

  // A new filter should start from the top, not leave the user mid-way down a
  // now-different list.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [query, regionFilter, exerciseFilter, selectedDay])

  if (!data) return <div className="p-6 text-ink-muted">Loading…</div>

  if (data.summaries.length === 0) {
    return (
      <div className="mt-24 px-6 text-center">
        <p className="text-[16px] font-semibold">No workouts yet</p>
        <p className="mt-1 text-[14px] text-ink-muted">
          Tap the + button to log your first one.
        </p>
      </div>
    )
  }

  async function discard(workoutId: string) {
    await repo.deleteWorkout(workoutId)
    setMenuFor(null)
    toast.show('Workout deleted', () => void repo.restoreWorkout(workoutId))
  }

  const visible = filtered.slice(0, visibleCount)

  return (
    <div className="px-3 py-3">
      {/* List / Calendar toggle. */}
      <div className="mb-2.5 flex gap-1 rounded-xl bg-sunken p-1">
        <ViewToggle
          active={view === 'list'}
          icon={<List size={15} />}
          label="List"
          onClick={() => setView('list')}
        />
        <ViewToggle
          active={view === 'calendar'}
          icon={<CalendarDays size={15} />}
          label="Calendar"
          onClick={() => setView('calendar')}
        />
      </div>

      {view === 'calendar' && (
        <HistoryCalendar
          summaries={data.summaries}
          weekStartsOn={data.profile.weekStartsOn}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
        />
      )}

      {/* Search by workout name or any exercise in it — the QOL win once there
          are hundreds of sessions. */}
      <div className="mb-2 flex h-11 items-center gap-2 rounded-xl bg-sunken px-3">
        <Search size={17} className="shrink-0 text-ink-muted" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search workouts and exercises"
          className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-ink-muted"
        />
        {query && (
          <button onClick={() => setQuery('')} aria-label="Clear search">
            <X size={17} className="text-ink-muted" />
          </button>
        )}
      </div>

      {/* Body-part and exercise filters, mirroring the Insights filter bar. */}
      <div className="mb-2.5 flex gap-1.5 overflow-x-auto">
        <FilterChipButton
          label={summarizeFilter(
            'Body part',
            regionFilter,
            (v) => REGION_LABELS[v as Region],
          )}
          isActive={regionFilter.length > 0}
          onClick={() => setOpenSheet('region')}
        />
        <FilterChipButton
          label={summarizeFilter(
            'Exercise',
            exerciseFilter,
            (id) => exerciseOptions.find((e) => e.value === id)?.label ?? 'Exercise',
          )}
          isActive={exerciseFilter.length > 0}
          onClick={() => setOpenSheet('exercise')}
        />
        {selectedDay !== null && (
          <button
            onClick={() => setSelectedDay(null)}
            className="flex shrink-0 items-center gap-1 rounded-full border border-accent bg-accent-wash px-3 py-1.5 text-[13px] font-medium text-accent"
          >
            {format(selectedDay, 'MMM d')} <X size={13} />
          </button>
        )}
        {(regionFilter.length > 0 || exerciseFilter.length > 0) && (
          <button
            onClick={() => {
              setRegionFilter([])
              setExerciseFilter([])
            }}
            className="shrink-0 px-2 text-[13px] font-semibold text-accent"
          >
            Clear
          </button>
        )}
      </div>

      {filtered.length === 0 && (
        <p className="mt-10 text-center text-[14px] text-ink-muted">
          {hasFilters ? 'No workouts match these filters.' : 'No workouts to show.'}
        </p>
      )}

      <div className="space-y-2.5">
        {visible.map((summary) => (
          <Card key={summary.workout.id} className="relative overflow-visible">
            <div className="flex items-start">
              <button
                onClick={() => onOpenWorkout(summary.workout.id)}
                className="min-w-0 flex-1 px-4 py-3.5 text-left active:bg-accent-wash"
              >
                <p className="truncate text-[15.5px] font-semibold">{summary.title}</p>
                <p className="text-[12.5px] text-ink-muted">
                  {formatDayHeading(summary.workout.startedAt)} ·{' '}
                  {formatTimeOfDay(summary.workout.startedAt)}
                  {summary.workout.endedAt === null && ' · in progress'}
                </p>

                {/* Region dots give the session a shape at a glance. */}
                {summary.regions.length > 0 && (
                  <div className="mt-2 flex items-center gap-1">
                    {summary.regions.map((region) => (
                      <span
                        key={region}
                        className="size-2 rounded-full"
                        style={{ background: regionVar(region) }}
                        aria-label={REGION_LABELS[region]}
                      />
                    ))}
                  </div>
                )}

                <p className="mt-2 truncate text-[12.5px] text-ink-secondary">
                  {summary.exerciseNames.join(' · ') || 'No exercises'}
                </p>

                <div className="mt-2.5 flex gap-4 text-[12.5px] text-ink-muted">
                  <span className="tabular">{summary.setCount} sets</span>
                  {summary.volumeKg > 0 && (
                    <span className="tabular">
                      {formatDisplayWeight(summary.volumeKg, data.profile.unitWeight)}
                    </span>
                  )}
                  {summary.durationSeconds !== null && (
                    <span className="tabular">
                      {formatDuration(summary.durationSeconds)}
                    </span>
                  )}
                </div>
              </button>

              <div className="flex shrink-0 flex-col items-center gap-1 py-3 pr-2">
                <button
                  onClick={() => setMenuFor(summary.workout.id)}
                  aria-label={`Options for ${summary.title}`}
                  className="flex size-9 items-center justify-center rounded-lg text-ink-muted active:bg-sunken"
                >
                  <MoreHorizontal size={18} />
                </button>
                <ChevronRight size={16} className="text-ink-muted" />
              </div>
            </div>

            {menuFor === summary.workout.id && (
              <RowMenu
                onRepeat={() => {
                  setPreviewFor(summary.workout.id)
                  setMenuFor(null)
                }}
                onSaveTemplate={() => {
                  setTemplateFor({
                    id: summary.workout.id,
                    name: summary.title,
                  })
                  setMenuFor(null)
                }}
                onEdit={() => {
                  setMenuFor(null)
                  onOpenWorkout(summary.workout.id)
                }}
                onDiscard={() => void discard(summary.workout.id)}
                onDismiss={() => setMenuFor(null)}
              />
            )}
          </Card>
        ))}
      </div>

      {/* Reveal another page rather than rendering thousands of rows at once. */}
      {filtered.length > visible.length && (
        <button
          onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
          className="mt-3 w-full rounded-xl border border-line py-2.5 text-[14px] font-semibold text-ink-secondary active:bg-sunken"
        >
          Show more ({filtered.length - visible.length} older)
        </button>
      )}

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

      {openSheet === 'exercise' && (
        <FilterSheet
          title="Exercise"
          options={exerciseOptions}
          selected={exerciseFilter}
          onChange={setExerciseFilter}
          onDismiss={() => setOpenSheet(null)}
        />
      )}

      {previewFor && (
        <WorkoutPreviewSheet
          workoutId={previewFor}
          onStart={(newId) => {
            setPreviewFor(null)
            onStartedCopy(newId)
          }}
          onDismiss={() => setPreviewFor(null)}
        />
      )}

      {templateFor && (
        <SaveTemplateSheet
          workoutId={templateFor.id}
          suggestedName={templateFor.name}
          onDone={(message) => {
            setTemplateFor(null)
            toast.show(message)
          }}
          onDismiss={() => setTemplateFor(null)}
        />
      )}
    </div>
  )
}

function ViewToggle({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[13.5px] font-semibold',
        active ? 'bg-surface text-ink shadow-sm' : 'text-ink-secondary',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

/** "Body part", "Chest", or "3 body parts" — the chip's label by selection count. */
function summarizeFilter(
  noun: string,
  selected: string[],
  labelOf: (value: string) => string,
): string {
  if (selected.length === 0) return noun
  if (selected.length === 1) return labelOf(selected[0]!)
  return `${selected.length} ${noun.toLowerCase()}s`
}

function RowMenu({
  onRepeat,
  onSaveTemplate,
  onEdit,
  onDiscard,
  onDismiss,
}: {
  onRepeat: () => void
  onSaveTemplate: () => void
  onEdit: () => void
  onDiscard: () => void
  onDismiss: () => void
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onDismiss} />
      <div className="absolute right-2 top-12 z-50 w-56 overflow-hidden rounded-xl border border-line-strong bg-surface shadow-xl">
        <MenuItem
          icon={<Copy size={16} />}
          label="Do this workout again"
          onClick={onRepeat}
        />
        <MenuItem
          icon={<FileText size={16} />}
          label="Save as template"
          onClick={onSaveTemplate}
        />
        <MenuItem
          icon={<ChevronRight size={16} />}
          label="Open and edit"
          onClick={onEdit}
        />
        <MenuItem
          icon={<Trash2 size={16} />}
          label="Delete workout"
          onClick={onDiscard}
          destructive
        />
      </div>
    </>
  )
}

function MenuItem({
  icon,
  label,
  onClick,
  destructive = false,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'flex w-full items-center gap-2.5 border-b border-line px-3.5 py-3 text-left text-[14px] font-medium last:border-0 active:bg-accent-wash',
        destructive ? 'text-critical' : '',
      ].join(' ')}
    >
      <span className="shrink-0 text-ink-muted">{icon}</span>
      {label}
    </button>
  )
}

function SaveTemplateSheet({
  workoutId,
  suggestedName,
  onDone,
  onDismiss,
}: {
  workoutId: string
  suggestedName: string
  onDone: (message: string) => void
  onDismiss: () => void
}) {
  const [name, setName] = useState(suggestedName)
  const [isBusy, setIsBusy] = useState(false)

  async function save() {
    if (!name.trim()) return
    setIsBusy(true)
    try {
      await repo.saveWorkoutAsTemplate(workoutId, name.trim())
      onDone(`Saved "${name.trim()}" as a template`)
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <BottomSheet onDismiss={onDismiss}>
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h2 className="text-[17px] font-bold tracking-tight">Save as template</h2>
        <button
          onClick={onDismiss}
          aria-label="Close"
          className="flex size-9 items-center justify-center rounded-lg text-ink-muted active:bg-sunken"
        >
          <X size={19} />
        </button>
      </div>
      <div className="p-5">
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Pull A"
          className="h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-[16px] outline-none focus:border-accent"
        />
        <p className="mt-2 text-[12.5px] text-ink-muted">
          Saves the exercises and set counts. Weights come from your history each time you
          run it.
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" size="lg" className="flex-1" onClick={onDismiss}>
            Cancel
          </Button>
          <Button
            size="lg"
            className="flex-1"
            disabled={isBusy || !name.trim()}
            onClick={() => void save()}
          >
            Save
          </Button>
        </div>
      </div>
    </BottomSheet>
  )
}
