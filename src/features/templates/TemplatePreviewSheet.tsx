/**
 * Preview a template before starting a workout from it (§7.4).
 *
 * The distinction this sheet makes explicit: starting a workout from a template
 * creates a **fresh session** — a copy. Editing that session later changes the
 * session, not the template. The template is edited separately, from the
 * Templates screen. Stating this on the button that crosses the boundary is
 * what keeps "am I changing the plan or the workout?" from ever being unclear.
 */

import { useLiveQuery } from 'dexie-react-hooks'
import { Pencil, Play, X } from 'lucide-react'
import * as repo from '@/data/repository'
import { useActiveWorkout } from '@/data/useActiveWorkout'
import { BottomSheet } from '@/components/BottomSheet'
import { Button } from '@/components/Button'
import { regionVar } from '@/lib/palette'
import { REGION_LABELS } from '@/domain/types'

export function TemplatePreviewSheet({
  templateId,
  onStart,
  onEdit,
  onDismiss,
}: {
  templateId: string
  /** Called with the id of the new workout once the user commits. */
  onStart: (newWorkoutId: string) => void
  /** Optional — jump to editing the template instead of running it. */
  onEdit?: () => void
  onDismiss: () => void
}) {
  const preview = useLiveQuery(() => repo.getTemplatePreview(templateId), [templateId])
  const active = useActiveWorkout()

  async function start() {
    onStart(await repo.startWorkoutFromTemplate(templateId))
  }

  return (
    <BottomSheet onDismiss={onDismiss} panelClassName="max-h-[85%] overflow-y-auto">
      <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-line bg-surface px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="truncate text-[18px] font-bold tracking-tight">
            {preview?.title ?? 'Template'}
          </h2>
          <p className="text-[12.5px] text-ink-muted">
            Template · {preview?.exercises.length ?? 0} exercises ·{' '}
            {preview?.totalSets ?? 0} planned sets
          </p>
        </div>
        <button
          onClick={onDismiss}
          aria-label="Close"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-muted active:bg-sunken"
        >
          <X size={19} />
        </button>
      </div>

      {!preview ? (
        <p className="px-5 py-8 text-center text-ink-muted">Loading…</p>
      ) : (
        <div className="divide-y divide-line px-5">
          {preview.exercises.map((exercise, index) => (
            <div key={index} className="flex items-center gap-2.5 py-3">
              {exercise.region && (
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: regionVar(exercise.region) }}
                  aria-label={REGION_LABELS[exercise.region]}
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">
                  {exercise.name}
                </span>
                <span className="block truncate text-[12.5px] text-ink-muted">
                  {exercise.detail}
                </span>
              </span>
            </div>
          ))}
          {preview.exercises.length === 0 && (
            <p className="py-8 text-center text-[14px] text-ink-muted">
              This template has no exercises yet. Edit it to add some.
            </p>
          )}
        </div>
      )}

      <div className="px-5 pt-3">
        <p className="text-[12px] text-ink-muted">
          {active
            ? 'Finish the workout you’re in before starting another one.'
            : "Starts a new workout from this plan. Editing the workout won't change the template."}
        </p>
      </div>

      <div className="sticky bottom-0 mt-2 flex gap-2 border-t border-line bg-surface px-4 py-3">
        {onEdit && (
          <Button
            variant="secondary"
            size="lg"
            onClick={onEdit}
            aria-label="Edit template"
          >
            <Pencil size={17} />
          </Button>
        )}
        {active ? (
          <Button size="lg" className="flex-1" onClick={() => onStart(active.id)}>
            <Play size={17} />
            Resume your workout
          </Button>
        ) : (
          <Button
            size="lg"
            className="flex-1"
            disabled={!preview || preview.exercises.length === 0}
            onClick={() => void start()}
          >
            <Play size={17} />
            Start workout
          </Button>
        )}
      </div>
    </BottomSheet>
  )
}
