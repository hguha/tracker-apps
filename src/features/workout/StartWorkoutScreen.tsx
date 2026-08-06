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

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react'
import * as repo from '@/data/repository'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { formatRelativeDay } from '@/lib/dates'
import { weightFromKg } from '@/lib/units'
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

  const data = useLiveQuery(async () => {
    const profile = await repo.getProfile()
    const templates = await repo.listTemplates()
    const withCounts = await Promise.all(
      templates.map(async (template) => ({
        template,
        exerciseCount: (await repo.listTemplateExercises(template.id)).length,
      })),
    )
    const recent = (await repo.listWorkoutSummaries(12)).filter(
      (s) => s.workout.endedAt !== null && s.setCount > 0,
    )
    return { profile, templates: withCounts, recent }
  }, [])

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
        <h1 className="flex-1 text-[16px] font-semibold tracking-tight">
          Log a workout
        </h1>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <Button size="lg" className="w-full" onClick={() => void startEmpty()}>
          <Sparkles size={18} />
          Start an empty workout
        </Button>

        {data && data.templates.length > 0 && (
          <Card className="overflow-hidden">
            <SectionLabel>Templates</SectionLabel>
            {data.templates.map(({ template, exerciseCount }) => (
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

        {data && data.recent.length > 0 && (
          <Card className="overflow-hidden">
            <SectionLabel>Do one again</SectionLabel>
            {data.recent.map((summary) => (
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
                      ` · ${Math.round(
                        weightFromKg(summary.volumeKg, data.profile.unitWeight),
                      ).toLocaleString()} ${data.profile.unitWeight}`}
                  </span>
                </span>
                <ChevronRight size={17} className="mt-1 shrink-0 text-ink-muted" />
              </button>
            ))}
          </Card>
        )}

        {data && data.recent.length === 0 && data.templates.length === 0 && (
          <p className="px-4 pt-6 text-center text-[13.5px] text-ink-muted">
            Once you've logged a few workouts, they'll show up here so you can
            repeat one with a tap.
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
