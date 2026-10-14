// Serves both a live session and an edit of a past one (§6.6); `isEditMode`
// suppresses the timers but leaves every mutation available.

import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus } from 'lucide-react'
import * as repo from '@/data/repository'
import { BottomSheet } from '@/components/BottomSheet'
import { Button } from '@/components/Button'
import { useToast } from '@/components/Toast'
import { CelebrationOverlay, useCelebrations } from '@tracker-engine/ui'
import { DragItem, DragList } from '@/components/DragList'
import { RestTimerBar } from '@/features/timer/RestTimerBar'
import { useRestTimer } from '@/features/timer/restTimerStore'
import { playCue } from '@/features/timer/sounds'
import { sessionTitle } from '@/lib/sessionTitle'
import type { Equipment, LoadMode, WorkoutSet } from '@/domain/types'
import { ActiveWorkoutHeader } from './ActiveWorkoutHeader'
import { DetachedNotice, LeaveEditConfirm } from './ActiveWorkoutSheets'
import { ExerciseCard } from './ExerciseCard'
import { ExerciseDetailSheet } from './ExerciseDetailSheet'
import { ExercisePicker } from './ExercisePicker'
import { FinishSheet } from './FinishSheet'
import { SessionMenu } from './SessionMenu'
import { lastLiftRestSeconds, restSecondsFor } from './rest'
import { CoachChat } from '@/features/coach/CoachChat'
import { isCardioPattern } from '@/domain/movement'

// How many finished sessions before the swipe hint retires. Deleting and reusing a
// set have no visible control, so one showing isn't enough to learn them.
const GESTURE_HINT_WORKOUTS = 3

async function loadSession(workoutId: string) {
  const workout = await repo.getWorkout(workoutId)
  if (!workout) return null

  const profile = await repo.getProfile()
  const workoutExercises = await repo.listWorkoutExercises(workoutId)

  const rows = await Promise.all(
    workoutExercises.map(async (we) => ({
      workoutExercise: we,
      exercise: await repo.getExercise(we.exerciseId),
      sets: await repo.listSets(we.id),
      // Relative to *this* workout, so editing an older session shows what
      // came before it rather than the newest session overall.
      previousSession: await repo.getPreviousSession(we.exerciseId, we.equipment, workoutId),
    })),
  )

  // Named only while the session still matches the template it came from.
  const template =
    workout.templateId === null ? null : await repo.getTemplate(workout.templateId)
  const titleSignals = await repo.getSessionTitleSignals(workoutId)
  const placeholderOverrides = await repo.getPlaceholderOverrides(workoutId)
  // Swipe is the only way to delete or reuse a set, so the hint stays until the
  // gestures have plausibly been learned rather than showing exactly once.
  const finishedWorkouts = await repo.countFinishedWorkouts()

  return { workout, profile, template, rows, titleSignals, placeholderOverrides, finishedWorkouts }
}

type SessionRow = NonNullable<Awaited<ReturnType<typeof loadSession>>>['rows'][number]

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
  const celebrations = useCelebrations(null, null)

  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [isFinishOpen, setIsFinishOpen] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isCoachOpen, setIsCoachOpen] = useState(false)
  const [isLeaveConfirmOpen, setIsLeaveConfirmOpen] = useState(false)
  // The template this session stopped following, held just long enough to say so.
  const [detachedFrom, setDetachedFrom] = useState<string | null>(null)
  const [detailFor, setDetailFor] = useState<{
    exerciseId: string
    workoutExerciseId: string
  } | null>(null)

  const data = useLiveQuery(() => loadSession(workoutId), [workoutId])

  // Editing a past workout is a transaction (§6.6): the snapshot backs Cancel and
  // holds this workout's writes back until Done, so a cancelled edit never ships.
  useEffect(() => {
    if (!isEditMode) return
    void repo.beginWorkoutEdits(workoutId)
  }, [isEditMode, workoutId])

  if (data === undefined) return null
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

  const { workout, profile, template, rows, titleSignals, placeholderOverrides } = data

  // Single path for logging a set: writes values, then the rest timer, log cue,
  // and PR feedback (§6.2).
  async function handleSetChange(setId: string, patch: Partial<WorkoutSet>, row: SessionRow) {
    const before = await repo.getSet(setId)
    const wasLogged = before?.isCompleted ?? false

    // Measured rest can't be reconstructed later, so capture it now or lose it.
    const measured = timer.elapsedSeconds()
    const brokenRecords = await repo.logSetValues(setId, {
      ...patch,
      ...(measured !== null && !wasLogged ? { restTakenSeconds: measured } : {}),
    })

    const after = await repo.getSet(setId)
    const isNowLogged = after?.isCompleted ?? false

    // Only a transition into "logged" plays the cue — correcting an
    // already-logged number is not a new set.
    if (!wasLogged && isNowLogged) {
      playCue('set-logged')

      // Opt-in (§6.4.2). A running timer is never restarted — that would
      // misreport the measured gap. Cardio never rests.
      const shouldAutoStart =
        profile.autoStartRest &&
        !isEditMode &&
        !(row.exercise && isCardioPattern(row.exercise.movementPattern)) &&
        timer.targetAt === null
      if (shouldAutoStart) {
        timer.start(restSecondsFor(row, profile), {
          setId,
          exerciseId: row.workoutExercise.exerciseId,
        })
      }
    }

    if (brokenRecords.length > 0) {
      playCue('pr')
      celebrations.push(recordCelebration(setId, brokenRecords.length, row.exercise?.name))
    }
  }

  async function handleDeleteSet(setId: string) {
    await repo.deleteSet(setId)
    playCue('undo')
    toast.show('Set deleted', () => void repo.restoreSet(setId))
  }

  async function handleDuplicateSet(set: WorkoutSet) {
    await repo.addSet({
      workoutExerciseId: set.workoutExerciseId,
      weightKg: set.weightKg,
      reps: set.reps,
      durationSeconds: set.durationSeconds,
      distanceM: set.distanceM,
      isCompleted: true,
      afterPosition: set.position,
    })
  }

  async function detachFromTemplate() {
    const wasFollowing = await repo.detachWorkoutFromTemplate(workoutId)
    if (wasFollowing !== null) setDetachedFrom(wasFollowing)
  }

  async function handleAddExercise(
    exerciseId: string,
    equipment: Equipment,
    loadMode: LoadMode | null,
  ) {
    const workoutExerciseId = await repo.addExerciseToWorkout(
      workoutId,
      exerciseId,
      equipment,
      loadMode,
    )

    // One row is enough: its placeholder comes from history and "Add set"
    // carries the ghost forward (§6.2).
    await repo.addSetWithPlaceholder(workoutExerciseId, exerciseId)
    playCue('exercise-added')
    setIsPickerOpen(false)
    // Adding an exercise changes the session's shape, so it is no longer an
    // instance of the template it started from.
    await detachFromTemplate()
  }

  async function handleSuperset(draggedId: string, targetId: string) {
    await repo.supersetExercises(draggedId, targetId)
    playCue('superset')
    toast.show('Grouped as a superset', () => void repo.removeFromSuperset(draggedId))
  }

  async function handleDiscard() {
    await repo.deleteWorkout(workoutId)
    timer.cancel()
    setIsMenuOpen(false)
    toast.show('Workout discarded', () => void repo.restoreWorkout(workoutId))
    onExit()
  }

  async function handleDoneEditing() {
    await repo.commitWorkoutEdits(workoutId)
    onExit()
  }

  async function handleCancelEditing() {
    await repo.cancelWorkoutEdits(workoutId)
    toast.show('Edits discarded')
    onExit()
  }

  // Leaving an edit means abandoning it, matching what a back arrow implies
  // everywhere else. Only prompt when there is something to lose; an edit that
  // changed nothing just closes.
  async function handleLeaveEditing() {
    if (await repo.hasUnsavedWorkoutEdits(workoutId)) {
      setIsLeaveConfirmOpen(true)
      return
    }
    await repo.cancelWorkoutEdits(workoutId)
    onExit()
  }

  const loggedSetCount = rows.flatMap((r) => r.sets).filter((s) => s.isCompleted).length

  // Guide a genuine first-timer through logging; drop it once they've logged a set.
  const showGestureHint =
    data.finishedWorkouts < GESTURE_HINT_WORKOUTS && !isEditMode && rows.length > 0

  // Backs "Delete last set" in the exercise sheet, so the gesture isn't the only way.
  const detailSets = detailFor
    ? (rows.find((r) => r.workoutExercise.id === detailFor.workoutExerciseId)?.sets ?? [])
    : []
  const lastSetOfDetail = detailSets[detailSets.length - 1]

  return (
    <div className="flex h-full flex-col">
      <ActiveWorkoutHeader
        title={sessionTitle(workout.title, workout.startedAt, titleSignals)}
        templateName={template?.name ?? null}
        startedAt={workout.startedAt}
        loggedSetCount={loggedSetCount}
        isEditMode={isEditMode}
        onBack={isEditMode ? () => void handleLeaveEditing() : onExit}
        onOpenCoach={() => setIsCoachOpen(true)}
        onOpenMenu={() => setIsMenuOpen(true)}
      />

      <div className="flex-1 overflow-y-auto px-2.5 py-2.5">
        {rows.length === 0 && (
          <div className="mt-16 text-center">
            <p className="text-[15px] text-ink-secondary">No exercises yet.</p>
            <p className="mt-1 text-[13px] text-ink-muted">
              Add your first one to start logging.
            </p>
          </div>
        )}

        {showGestureHint && (
          <div className="mb-2.5 rounded-2xl border border-accent/30 bg-accent-wash px-4 py-3 text-[13px] leading-relaxed text-ink-secondary">
            <p className="mb-0.5 font-semibold text-ink">How to log</p>
            Tap a set's fields and type your weight and reps — that logs it. Swipe a set
            left to delete it, or right to reuse it.
          </div>
        )}

        <DragList
          itemIds={rows.map((r) => r.workoutExercise.id)}
          onReorder={(ids) => void repo.reorderWorkoutExercises(ids)}
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
                    equipment={row.workoutExercise.equipment}
                    loadMode={row.workoutExercise.loadMode}
                    bodyweightKg={workout.bodyweightKg}
                    asOf={workout.startedAt}
                    isPastSession={isEditMode}
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
                    onSetChange={(setId, patch) => void handleSetChange(setId, patch, row)}
                    onDeleteSet={(setId) => void handleDeleteSet(setId)}
                    onConfirmPlaceholder={(setId, shown) => {
                      void repo.confirmPlaceholder(setId, shown).then((broken) => {
                        playCue(broken.length > 0 ? 'pr' : 'set-logged')
                        if (broken.length > 0) {
                          celebrations.push(
                            recordCelebration(setId, broken.length, row.exercise?.name),
                          )
                        }
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

      {!isEditMode && <RestTimerBar defaultSeconds={lastLiftRestSeconds(rows, profile)} />}

      <div className="border-t border-line bg-surface px-3 py-2.5 pb-safe">
        {isEditMode ? (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="lg"
              className="flex-1"
              onClick={() => void handleLeaveEditing()}
            >
              Discard
            </Button>
            <Button
              size="lg"
              className="flex-[2]"
              onClick={() => void handleDoneEditing()}
            >
              Save changes
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
          onPick={(exerciseId, equipment, loadMode) =>
            void handleAddExercise(exerciseId, equipment, loadMode)
          }
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
            void repo.removeWorkoutExercise(id).then(detachFromTemplate)
            toast.show('Exercise removed', () => void repo.restoreWorkoutExercise(id))
          }}
          onRemoveLastSet={
            lastSetOfDetail ? () => void handleDeleteSet(lastSetOfDetail.id) : undefined
          }
          onDismiss={() => setDetailFor(null)}
        />
      )}

      {isMenuOpen && (
        <SessionMenu
          workout={workout}
          // A session still following a template already has one; offering to save
          // it again would just make a duplicate.
          canSaveAsTemplate={rows.length > 0 && workout.templateId === null}
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

      {isCoachOpen && (
        <BottomSheet
          onDismiss={() => setIsCoachOpen(false)}
          panelClassName="h-[88%]"
          dismissOnBackdrop={false}
          labelledBy="coach-sheet"
        >
          {/* variant="sheet" feeds the chat the live session, so it can suggest accessories. */}
          <div className="flex h-full min-h-0 flex-col">
            <CoachChat variant="sheet" />
          </div>
        </BottomSheet>
      )}

      {detachedFrom !== null && (
        <DetachedNotice templateName={detachedFrom} onDismiss={() => setDetachedFrom(null)} />
      )}

      {isLeaveConfirmOpen && (
        <LeaveEditConfirm
          onKeepEditing={() => setIsLeaveConfirmOpen(false)}
          onDiscard={() => {
            setIsLeaveConfirmOpen(false)
            void handleCancelEditing()
          }}
          onSave={() => {
            setIsLeaveConfirmOpen(false)
            void handleDoneEditing()
          }}
        />
      )}
      {celebrations.current && (
        <CelebrationOverlay
          celebration={celebrations.current}
          onDone={celebrations.dismiss}
          placement="top"
        />
      )}
    </div>
  )
}

function recordCelebration(setId: string, count: number, exerciseName: string | undefined) {
  return {
    key: `pr:${setId}`,
    icons: ['🏆'],
    title: count === 1 ? 'New personal record' : `${count} new personal records`,
    subtitle: exerciseName ?? 'Keep it up.',
  }
}
