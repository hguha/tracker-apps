/**
 * The "log a workout" entry point (§7.4).
 *
 * The body is a list of recent sessions, each tappable to repeat. A single
 * "repeat last workout" button was wrong: on a 3-day rotation the next session is
 * rarely the immediately previous one, so that button forced a detour through
 * History for the common case.
 *
 * "Log a past workout" is gone — backdating is the session menu's date control
 * (§6.4), which removes a whole screen without removing the capability.
 */

import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronRight, Search, Sparkles, X } from 'lucide-react'
import * as repo from '@/data/repository'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { formatRelativeDay } from '@/lib/dates'
import { formatDisplayWeight } from '@/lib/units'
import { regionVar } from '@/lib/palette'
import { REGION_LABELS } from '@/domain/types'
import { WorkoutPreviewSheet } from './WorkoutPreviewSheet'
import { TemplatePreviewSheet } from '@/features/templates/TemplatePreviewSheet'

export function StartWorkoutScreen({
  onStarted,
  onCancel,
}: {
  onStarted: (workoutId: string) => void
  onCancel: () => void
}) {
  // Which workout / template is being previewed before committing to start it.
  const [previewWorkoutId, setPreviewWorkoutId] = useState<string | null>(null)
  const [previewTemplateId, setPreviewTemplateId] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const data = useLiveQuery(async () => {
    const profile = await repo.getProfile()
    const templates = await repo.listTemplates()
    const withCounts = await Promise.all(
      templates.map(async (template) => ({
        template,
        exerciseCount: (await repo.listTemplateExercises(template.id)).length,
      })),
    )
    // Pull a deep list so search reaches real history; the unsearched view still
    // shows just the most recent handful (sliced below).
    const recent = (await repo.listFinishedWorkoutSummaries(500)).filter(
      (s) => s.setCount > 0,
    )
    return { profile, templates: withCounts, recent }
  }, [])

  const q = query.trim().toLowerCase()

  // With no query, show the recent handful; with one, search title + exercises
  // across all of history so an old rotation is findable by name.
  const shownTemplates = useMemo(() => {
    const all = data?.templates ?? []
    if (!q) return all
    return all.filter((t) => t.template.name.toLowerCase().includes(q))
  }, [data, q])

  const shownRecent = useMemo(() => {
    const all = data?.recent ?? []
    if (!q) return all.slice(0, 12)
    return all.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.exerciseNames.some((name) => name.toLowerCase().includes(q)),
    )
  }, [data, q])

  const unit = data?.profile.unitWeight ?? 'lb'

  async function startEmpty() {
    onStarted(await repo.startWorkout())
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-line bg-surface px-2 py-2 pt-safe">
        <button
          onClick={onCancel}
          aria-label="Back"
          className="flex size-10 items-center justify-center rounded-lg text-ink-secondary active:bg-sunken"
        >
          <ChevronLeft size={22} />
        </button>
        <h1 className="flex-1 text-[16px] font-semibold tracking-tight">Log a workout</h1>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <Button size="lg" className="w-full" onClick={() => void startEmpty()}>
          <Sparkles size={18} />
          Start an empty workout
        </Button>

        {/* Search templates and past workouts by name — find a rotation without
            scrolling once history is deep. */}
        <div className="flex h-11 items-center gap-2 rounded-xl bg-sunken px-3">
          <Search size={17} className="shrink-0 text-ink-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search to repeat a workout"
            className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-ink-muted"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear search">
              <X size={17} className="text-ink-muted" />
            </button>
          )}
        </div>

        {shownTemplates.length > 0 && (
          <Card className="overflow-hidden">
            <SectionLabel>Templates</SectionLabel>
            {shownTemplates.map(({ template, exerciseCount }) => (
              <button
                key={template.id}
                onClick={() => setPreviewTemplateId(template.id)}
                className="flex w-full items-center gap-3 border-t border-line px-4 py-3.5 text-left active:bg-accent-wash"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">
                    {template.name}
                  </span>
                  <span className="block text-[12.5px] text-ink-muted">
                    {exerciseCount} exercises
                    {template.lastUsedAt !== null &&
                      ` · last used ${formatRelativeDay(template.lastUsedAt)}`}
                  </span>
                </span>
                <ChevronRight size={17} className="shrink-0 text-ink-muted" />
              </button>
            ))}
          </Card>
        )}

        {shownRecent.length > 0 && (
          <Card className="overflow-hidden">
            <SectionLabel>{q ? 'Matching workouts' : 'Do one again'}</SectionLabel>
            {shownRecent.map((summary) => (
              <button
                key={summary.workout.id}
                onClick={() => setPreviewWorkoutId(summary.workout.id)}
                className="flex w-full items-start gap-3 border-t border-line px-4 py-3.5 text-left active:bg-accent-wash"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    {summary.regions.map((region) => (
                      <span
                        key={region}
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: regionVar(region) }}
                        aria-label={REGION_LABELS[region]}
                      />
                    ))}
                    <span className="truncate text-[15px] font-medium">
                      {summary.title}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-[12.5px] text-ink-secondary">
                    {summary.exerciseNames.slice(0, 4).join(', ')}
                    {summary.exerciseNames.length > 4 &&
                      ` +${summary.exerciseNames.length - 4}`}
                  </span>
                  <span className="tabular mt-0.5 block text-[12px] text-ink-muted">
                    {summary.setCount} sets
                    {summary.volumeKg > 0 &&
                      ` · ${formatDisplayWeight(summary.volumeKg, unit)}`}
                  </span>
                </span>
                <ChevronRight size={17} className="mt-1 shrink-0 text-ink-muted" />
              </button>
            ))}
          </Card>
        )}

        {data && shownRecent.length === 0 && shownTemplates.length === 0 && (
          <p className="px-4 pt-6 text-center text-[13.5px] text-ink-muted">
            {q
              ? `Nothing matches “${query.trim()}”.`
              : "Once you've logged a few workouts, they'll show up here so you can repeat one with a tap."}
          </p>
        )}

        <div className="h-4" />
      </div>

      {previewWorkoutId && (
        <WorkoutPreviewSheet
          workoutId={previewWorkoutId}
          onStart={(newId) => {
            setPreviewWorkoutId(null)
            onStarted(newId)
          }}
          onDismiss={() => setPreviewWorkoutId(null)}
        />
      )}

      {previewTemplateId && (
        <TemplatePreviewSheet
          templateId={previewTemplateId}
          onStart={(newId) => {
            setPreviewTemplateId(null)
            onStarted(newId)
          }}
          onDismiss={() => setPreviewTemplateId(null)}
        />
      )}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 pt-3.5 pb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
      {children}
    </p>
  )
}
