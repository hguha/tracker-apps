// A flat list of movements (exercises). Equipment isn't a property of an exercise
// — it's chosen when adding to a workout — so this just lists movements and calls
// back with the chosen id. The picker follows a tap with an equipment step; the
// library opens the exercise detail.

import { ChevronRight } from 'lucide-react'
import { regionVar } from '@/lib/palette'
import { formatRelativeDay } from '@/lib/dates'
import { REGION_LABELS, type Exercise } from '@/domain/types'

export function MovementList({
  exercises,
  lastTrained,
  onChoose,
}: {
  // Already filtered and ordered by the caller.
  exercises: Exercise[]
  lastTrained?: Map<string, number>
  onChoose: (exerciseId: string) => void
}) {
  return (
    <>
      {exercises.map((exercise) => {
        const lastAt = lastTrained?.get(exercise.id)
        return (
          <button
            key={exercise.id}
            onClick={() => onChoose(exercise.id)}
            className="flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left transition-transform duration-75 last:border-0 active:scale-[0.99] active:bg-accent-wash"
          >
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: regionVar(exercise.region) }}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium">
                {exercise.name}
              </span>
              <span className="block truncate text-[12.5px] text-ink-muted">
                {[
                  REGION_LABELS[exercise.region],
                  lastAt ? formatRelativeDay(lastAt) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
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
    </>
  )
}
