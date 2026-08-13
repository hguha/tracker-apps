// Serves both a live session and an edit of a past one (§6.6); `isEditMode`
// suppresses the timers but leaves every mutation available.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, MoreHorizontal, Plus } from 'lucide-react'
import { db } from '@/db/database'
import * as repo from '@/data/repository'
import { Button } from '@/components/Button'
import { useToast } from '@/components/Toast'
import { DragItem, DragList } from '@/components/DragList'
import { RestTimerBar } from '@/features/timer/RestTimerBar'
import { useRestTimer } from '@/features/timer/restTimerStore'
import { playCue } from '@/features/timer/sounds'
import { formatDuration } from '@/lib/units'
import { sessionTitle } from '@/lib/sessionTitle'
import type { WorkoutSet } from '@/domain/types'
import { ExerciseCard } from './ExerciseCard'
import { ExerciseDetailSheet } from './ExerciseDetailSheet'
import { ExercisePicker } from './ExercisePicker'
import { FinishSheet } from './FinishSheet'
import { SessionMenu } from './SessionMenu'
import { isCardioPattern } from '@/domain/movement'

export function ActiveWorkoutScreen({
  workoutId,
  isEditMode = false,
  onExit,
}: {
  workoutId: string
  isEditMode?: boolean
  onExit: () => void
}) {
  const toast = useToast()
  const timer = useRestTimer()

  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [isFinishOpen, setIsFinishOpen] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [detailFor, setDetailFor] = useState<{
    exerciseId: string
    workoutExerciseId: string
  } | null>(null)

  const data = useLiveQuery(async () => {
    const workout = await repo.getWorkout(workoutId)
    if (!workout) return null

    const profile = await repo.getProfile()
    const workoutExercises = await repo.listWorkoutExercises(workoutId)

    const rows = await Promise.all(
      workoutExercises.map(async (we) => ({
        workoutExercise: we,
        exercise: await db.exercises.get(we.exerciseId),
        sets: await repo.listSets(we.id),
        // Relative to *this* workout, so editing an older session shows what
        // came before it rather than the newest session overall.
        previousSession: await repo.getPreviousSession(we.exerciseId, workoutId),
      })),
    )

    const muscles = await db.muscles.toArray()
    const muscleById = new Map(muscles.map((m) => [m.id, m]))
    const titleSignals = await repo.getSessionTitleSignals(workoutId)
    const placeholderOverrides = await repo.getPlaceholderOverrides(workoutId)

    return { workout, profile, rows, muscleById, titleSignals, placeholderOverrides }
  }, [workoutId])

  const [elapsedLabel, setElapsedLabel] = useState('')
  const startedAt = data?.workout.startedAt
  const endedAt = data?.workout.endedAt

  useEffect(() => {
    if (startedAt === undefined || endedAt !== null) return
    const tick = () => setElapsedLabel(formatDuration((Date.now() - startedAt) / 1000))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startedAt, endedAt])

  // Single path for logging a set: writes values, then the rest timer, log cue,
  // and PR feedback (§6.2).
  const handleSetChange = useCallback(
    async (setId: string, patch: Partial<WorkoutSet>, exerciseId: string) => {
      const before = await db.sets.get(setId)
      const wasLogged = before?.isCompleted ?? false

      // Measured rest can't be reconstructed later, so capture it now or lose it.
      const measured = timer.elapsedSeconds()
      const brokenRecords = await repo.logSetValues(setId, {
        ...patch,
        ...(measured !== null && !wasLogged ? { restTakenSeconds: measured } : {}),
      })

      const after = await db.sets.get(setId)
      const isNowLogged = after?.isCompleted ?? false

      // Only a transition into "logged" plays the cue — correcting an
      // already-logged number is not a new set.
      if (!wasLogged && isNowLogged) {
        playCue('set-logged')

        const row = data?.rows.find((r) => r.workoutExercise.exerciseId === exerciseId)
        // Opt-in (§6.4.2). A running timer is never restarted — that would
        // misreport the measured gap. Cardio never rests.
        const shouldAutoStart =
          (data?.profile.autoStartRest ?? false) &&
          !isEditMode &&
          !(row?.exercise && isCardioPattern(row.exercise.movementPattern)) &&
          timer.targetAt === null
        if (shouldAutoStart) {
          const seconds =
            row?.workoutExercise.restSeconds ??
            row?.exercise?.defaultRestSeconds ??
            data?.profile.defaultRestSeconds ??
            60
          timer.start(seconds, { setId, exerciseId })
        }
      }

      if (brokenRecords.length > 0) {
        playCue('pr')
        toast.show(
          brokenRecords.length === 1
            ? 'New personal record'
            : `${brokenRecords.length} new personal records`,
        )
      }
    },
    [
      data?.rows,
      data?.profile.defaultRestSeconds,
      data?.profile.autoStartRest,
      isEditMode,
      timer,
      toast,
    ],
  )

  const handleDeleteSet = useCallback(
    async (setId: string) => {
      await repo.deleteSet(setId)
      toast.show('Set deleted', () => void repo.restoreSet(setId))
    },
    [toast],
  )

  const handleDuplicateSet = useCallback(async (set: WorkoutSet) => {
    await repo.addSet({
      workoutExerciseId: set.workoutExerciseId,
      weightKg: set.weightKg,
      reps: set.reps,
      durationSeconds: set.durationSeconds,
      distanceM: set.distanceM,
      isCompleted: true,
      afterPosition: set.position,
    })
  }, [])

  const handleAddExercise = useCallback(
    async (exerciseId: string) => {
      const workoutExerciseId = await repo.addExerciseToWorkout(workoutId, exerciseId)

      // One row is enough: its placeholder comes from history and "Add set"
      // carries the ghost forward (§6.2).
      await repo.addSetWithPlaceholder(workoutExerciseId, exerciseId)
      setIsPickerOpen(false)
    },
    [workoutId],
  )

  const handleReorder = useCallback(async (orderedIds: string[]) => {
    await repo.reorderWorkoutExercises(orderedIds)
  }, [])

  const handleSuperset = useCallback(
    async (draggedId: string, targetId: string) => {
      await repo.supersetExercises(draggedId, targetId)
      playCue('set-logged')
      toast.show('Grouped as a superset', () => void repo.removeFromSuperset(draggedId))
    },
    [toast],
  )

  const handleDiscard = useCallback(async () => {
    await repo.deleteWorkout(workoutId)
    timer.cancel()
    setIsMenuOpen(false)
    toast.show('Workout discarded', () => void repo.restoreWorkout(workoutId))
    onExit()
  }, [workoutId, timer, toast, onExit])

  // Editing a past workout is a transaction (§6.6): the snapshot backs Cancel and
  // holds this workout's writes back until Done, so a cancelled edit never ships.
  useEffect(() => {
    if (!isEditMode) return
    void repo.beginWorkoutEdits(workoutId)
  }, [isEditMode, workoutId])

  const handleDoneEditing = useCallback(async () => {
    await repo.commitWorkoutEdits(workoutId)
    onExit()
  }, [workoutId, onExit])

  const handleCancelEditing = useCallback(async () => {
    await repo.cancelWorkoutEdits(workoutId)
    toast.show('Edits discarded')
    onExit()
  }, [workoutId, toast, onExit])

  const loggedSetCount = useMemo(
    () => data?.rows.flatMap((r) => r.sets).filter((s) => s.isCompleted).length ?? 0,
    [data?.rows],
  )

  if (data === undefined) {
    return <div className="p-6 text-ink-muted">Loading…</div>
  }
  if (data === null) {
    return (
      <div className="p-6">
        <p className="text-ink-secondary">This workout no longer exists.</p>
        <Button className="mt-4" onClick={onExit}>
          Go back
        </Button>
      </div>
    )
  }

  const { workout, profile, rows, muscleById, titleSignals, placeholderOverrides } = data
  const displayTitle = sessionTitle(workout.title, workout.startedAt, titleSignals)
  const orderedIds = rows.map((r) => r.workoutExercise.id)

  // The last non-cardio exercise is the one just trained; fall back to the default.
  const restDefaultSeconds =
    [...rows]
      .reverse()
      .find((r) => r.exercise && !isCardioPattern(r.exercise.movementPattern))
      ?.workoutExercise.restSeconds ??
    [...rows].reverse().find((r) => r.exercise?.defaultRestSeconds != null)?.exercise
      ?.defaultRestSeconds ??
    profile.defaultRestSeconds

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-1 border-b border-line bg-surface px-2 py-2">
        <button
          // Must commit, not merely navigate: the snapshot defers this workout's
          // writes, so an uncommitted exit would strand them unsent forever.
          onClick={() => (isEditMode ? void handleDoneEditing() : onExit())}
          aria-label="Back"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-secondary active:bg-sunken"
        >
          <ChevronLeft size={22} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[16px] font-semibold tracking-tight">
            {displayTitle}
          </h1>
          <p className="text-[12px] text-ink-muted">
            {isEditMode
              ? `${loggedSetCount} sets · editing`
              : `${elapsedLabel} · ${loggedSetCount} sets`}
          </p>
        </div>
        <button
          onClick={() => setIsMenuOpen(true)}
          aria-label="Workout options"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-secondary active:bg-sunken"
        >
          <MoreHorizontal size={20} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-2.5 py-2.5">
        {rows.length === 0 && (
          <div className="mt-16 text-center">
            <p className="text-[15px] text-ink-secondary">No exercises yet.</p>
            <p className="mt-1 text-[13px] text-ink-muted">
              Add your first one to start logging.
            </p>
          </div>
        )}

        <DragList
          itemIds={orderedIds}
          onReorder={(ids) => void handleReorder(ids)}
          onSuperset={(dragged, target) => void handleSuperset(dragged, target)}
        >
          <div className="space-y-2.5">
            {rows.map((row, index) => {
              if (!row.exercise) return null
              return (
                <DragItem
                  key={row.workoutExercise.id}
                  id={row.workoutExercise.id}
                  index={index}
                  supersetLabel={row.exercise.name}
                >
                  <ExerciseCard
                    exercise={row.exercise}
                    muscle={muscleById.get(row.exercise.primaryMuscleId)}
                    sets={row.sets}
                    previousSession={row.previousSession}
                    weightUnit={profile.unitWeight}
                    distanceUnit={profile.unitDistance}
                    showRpe={profile.showRpe}
                    supersetGroup={row.workoutExercise.supersetGroup}
                    sessionNote={row.workoutExercise.notes}
                    placeholderOverrides={placeholderOverrides}
                    onAddSet={() =>
                      void repo.addSetWithPlaceholder(
                        row.workoutExercise.id,
                        row.workoutExercise.exerciseId,
                      )
                    }
                    onSetChange={(setId, patch) =>
                      void handleSetChange(setId, patch, row.workoutExercise.exerciseId)
                    }
                    onDeleteSet={(setId) => void handleDeleteSet(setId)}
                    onConfirmPlaceholder={(setId, shown) => {
                      void repo.confirmPlaceholder(setId, shown).then((broken) => {
                        playCue(broken.length > 0 ? 'pr' : 'set-logged')
                        if (broken.length > 0) toast.show('New personal record')
                      })
                    }}
                    onDuplicateSet={(setId) => {
                      const set = row.sets.find((s) => s.id === setId)
                      if (set) void handleDuplicateSet(set)
                    }}
                    onOpenDetail={() =>
                      setDetailFor({
                        exerciseId: row.workoutExercise.exerciseId,
                        workoutExerciseId: row.workoutExercise.id,
                      })
                    }
                  />
                </DragItem>
              )
            })}
          </div>
        </DragList>

        <button
          onClick={() => setIsPickerOpen(true)}
          className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line-strong py-3.5 text-[15px] font-semibold text-accent active:bg-accent-wash"
        >
          <Plus size={18} />
          Add exercise
        </button>

        {rows.length > 1 && (
          <p className="mt-3 px-2 text-center text-[12px] text-ink-muted">
            Hold and drag a card to reorder, or drop it on another to superset them.
          </p>
        )}

        <div className="h-2" />
      </div>

      {!isEditMode && <RestTimerBar defaultSeconds={restDefaultSeconds} />}

      <div className="border-t border-line bg-surface px-3 py-2.5 pb-safe">
        {isEditMode ? (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="lg"
              className="flex-1"
              onClick={() => void handleCancelEditing()}
            >
              Cancel edits
            </Button>
            <Button
              size="lg"
              className="flex-[2]"
              onClick={() => void handleDoneEditing()}
            >
              Done editing
            </Button>
          </div>
        ) : (
          <Button size="lg" className="w-full" onClick={() => setIsFinishOpen(true)}>
            Finish workout
          </Button>
        )}
      </div>

      {isPickerOpen && (
        <ExercisePicker
          onPick={(exerciseId) => void handleAddExercise(exerciseId)}
          onDismiss={() => setIsPickerOpen(false)}
        />
      )}

      {detailFor && (
        <ExerciseDetailSheet
          exerciseId={detailFor.exerciseId}
          workoutExerciseId={detailFor.workoutExerciseId}
          currentWorkoutId={workoutId}
          weightUnit={profile.unitWeight}
          distanceUnit={profile.unitDistance}
          onRemoveFromWorkout={() => {
            const id = detailFor.workoutExerciseId
            void repo.removeWorkoutExercise(id)
            toast.show('Exercise removed', () => void repo.restoreWorkoutExercise(id))
          }}
          onDismiss={() => setDetailFor(null)}
        />
      )}

      {isMenuOpen && (
        <SessionMenu
          workout={workout}
          canSaveAsTemplate={rows.length > 0}
          onDiscard={() => void handleDiscard()}
          onDismiss={() => setIsMenuOpen(false)}
          onSaved={(message) => toast.show(message)}
        />
      )}

      {isFinishOpen && (
        <FinishSheet
          workoutId={workoutId}
          onDismiss={() => setIsFinishOpen(false)}
          onFinished={(outcome) => {
            timer.cancel()
            if (outcome === 'saved') playCue('workout-complete')
            onExit()
          }}
        />
      )}
    </div>
  )
}
