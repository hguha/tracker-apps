/**
 * Preview a past session before starting a copy of it (§7.2, §7.4).
 *
 * Tapping a workout in the start screen or history used to start it on the first
 * tap, giving no chance to confirm it was the right one. This sheet shows the
 * structure — exercises, set counts, last numbers — and only starts the copy on
 * an explicit "Start workout". The same sheet also previews a template before
 * instantiating it, so both entry points read the same way.
 */

import { useLiveQuery } from 'dexie-react-hooks'
import { Copy, X } from 'lucide-react'
import * as repo from '@/data/repository'
import { BottomSheet } from '@/components/BottomSheet'
import { Button } from '@/components/Button'
import { formatRelativeDay } from '@/lib/dates'
import { regionVar } from '@/lib/palette'
import { REGION_LABELS } from '@/domain/types'

export function WorkoutPreviewSheet({
  workoutId,
  onStart,
  onDismiss,
}: {
  workoutId: string
  /** Called with the id of the *new* copy once the user commits. */
  onStart: (newWorkoutId: string) => void
  onDismiss: () => void
}) {
  const preview = useLiveQuery(() => repo.getWorkoutPreview(workoutId), [workoutId])

  async function start() {
    const result = await repo.repeatWorkout(workoutId)
    if (result) onStart(result.workoutId)
  }

  return (
    <BottomSheet onDismiss={onDismiss} panelClassName="max-h-[85%] overflow-y-auto">
      <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-line bg-surface px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="truncate text-[18px] font-bold tracking-tight">
            {preview?.title ?? 'Workout'}
          </h2>
          {preview?.performedAt != null && (
            <p className="text-[12.5px] text-ink-muted">
              From {formatRelativeDay(preview.performedAt)} · {preview.totalSets} sets
            </p>
          )}
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
              This workout has no logged exercises.
            </p>
          )}
        </div>
      )}

      <div className="sticky bottom-0 flex gap-2 border-t border-line bg-surface px-4 py-3">
        <Button variant="secondary" size="lg" className="flex-1" onClick={onDismiss}>
          Cancel
        </Button>
        <Button
          size="lg"
          className="flex-[2]"
          disabled={!preview || preview.exercises.length === 0}
          onClick={() => void start()}
        >
          <Copy size={17} />
          Start workout
        </Button>
      </div>
    </BottomSheet>
  )
}
