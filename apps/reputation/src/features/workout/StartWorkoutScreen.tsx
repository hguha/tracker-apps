import { plural } from '@tracker-engine/core'
import { useMemo, useState } from 'react'
import { ScreenHeader, SearchField, SectionLabel } from '@tracker-engine/ui'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight, Sparkles } from 'lucide-react'
import * as repo from '@/data/repository'
import { playCue } from '@/features/timer/sounds'
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
    // Pull a deep list so search reaches real history; the unsearched view slices to a handful below.
    const recent = (await repo.listFinishedWorkoutSummaries(500)).filter(
      (s) => s.setCount > 0,
    )
    return { profile, templates: withCounts, recent }
  }, [])

  const q = query.trim().toLowerCase()

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
    playCue('workout-start')
    onStarted(await repo.startWorkout())
  }

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Log a workout" onBack={onCancel} />

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <Button size="lg" className="w-full" onClick={() => void startEmpty()}>
          <Sparkles size={18} />
          Start an empty workout
        </Button>

        <SearchField value={query} onChange={setQuery} placeholder="Search to repeat a workout" />

        {shownTemplates.length > 0 && (
          <Card className="overflow-hidden">
            <SectionLabel className="px-4 pt-3.5 pb-1">Templates</SectionLabel>
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
            <SectionLabel className="px-4 pt-3.5 pb-1">{q ? 'Matching workouts' : 'Do one again'}</SectionLabel>
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
                    {plural(summary.setCount, 'set')}
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
          <Card className="px-4 py-3 text-[13px] text-ink-muted">
            {q
              ? `Nothing matches “${query.trim()}”.`
              : "Once you've logged a few workouts, they'll show up here so you can repeat one with a tap."}
          </Card>
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
