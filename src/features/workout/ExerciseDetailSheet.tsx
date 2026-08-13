import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Trash2, X } from 'lucide-react'
import * as repo from '@/data/repository'
import { BottomSheet } from '@/components/BottomSheet'
import { Button } from '@/components/Button'
import { formatRelativeDay } from '@/lib/dates'
import { displayWeight, formatDuration, distanceFromM, weightFromKg } from '@/lib/units'
import { regionVar } from '@/lib/palette'
import { humanizeSlug } from '@/lib/labels'
import {
  REGION_LABELS,
  type DistanceUnit,
  type Region,
  type RecordType,
  type WeightUnit,
  type WorkoutSet,
} from '@/domain/types'

const RECORD_LABELS: Record<RecordType, string> = {
  max_weight: 'Heaviest weight',
  max_reps_any_weight: 'Most reps',
  max_est_1rm: 'Best estimated 1RM',
  max_volume_session: 'Most volume in a session',
  max_duration: 'Longest duration',
  max_distance: 'Farthest distance',
}

export function ExerciseDetailSheet({
  exerciseId,
  workoutExerciseId,
  currentWorkoutId,
  weightUnit,
  distanceUnit,
  onRemoveFromWorkout,
  onDismiss,
}: {
  exerciseId: string
  // Present when opened from inside a session — enables session-scoped actions.
  workoutExerciseId?: string
  // The active session's id, so "This session" reflects *this* workout, not the
  // most recent historical one (which would show stale numbers).
  currentWorkoutId?: string
  weightUnit: WeightUnit
  distanceUnit: DistanceUnit
  onRemoveFromWorkout?: () => void
  onDismiss: () => void
}) {
  const detail = useLiveQuery(() => repo.getExerciseDetail(exerciseId), [exerciseId])
  const [noteDraft, setNoteDraft] = useState<string | null>(null)

  // The note scoped to this exercise in this workout, kept separate from the
  // standing note: one is a diary entry, the other a setup reminder.
  const sessionRow = useLiveQuery(
    async () =>
      workoutExerciseId === undefined
        ? null
        : ((await repo.getWorkoutExercise(workoutExerciseId)) ?? null),
    [workoutExerciseId],
  )
  const [sessionNoteDraft, setSessionNoteDraft] = useState<string | null>(null)

  // Adopt the stored note once it loads, without clobbering an in-progress edit.
  useEffect(() => {
    if (detail && noteDraft === null) setNoteDraft(detail.exercise.notes)
  }, [detail, noteDraft])

  useEffect(() => {
    if (sessionRow && sessionNoteDraft === null) setSessionNoteDraft(sessionRow.notes)
  }, [sessionRow, sessionNoteDraft])

  if (!detail) return null

  const { exercise, primaryMuscle, records, sessions } = detail
  // "This session" must be matched by id; falling back to sessions[0] would show
  // the most recent historical session's numbers before anything is logged here.
  const thisSession = currentWorkoutId
    ? sessions.find((s) => s.workoutId === currentWorkoutId)
    : sessions[0]

  function formatRecordValue(type: RecordType, value: number): string {
    switch (type) {
      case 'max_weight':
      case 'max_est_1rm':
        return `${weightFromKg(value, weightUnit)} ${weightUnit}`
      case 'max_volume_session':
        return `${Math.round(weightFromKg(value, weightUnit)).toLocaleString()} ${weightUnit}`
      case 'max_reps_any_weight':
        return `${value} reps`
      case 'max_duration':
        return formatDuration(value)
      case 'max_distance':
        return `${distanceFromM(value, distanceUnit)} ${distanceUnit}`
    }
  }

  function describeSet(set: WorkoutSet): string {
    if (set.distanceM !== null && set.durationSeconds !== null) {
      return `${distanceFromM(set.distanceM, distanceUnit)}${distanceUnit} / ${formatDuration(set.durationSeconds)}`
    }
    if (set.durationSeconds !== null) return formatDuration(set.durationSeconds)
    if (set.weightKg !== null && set.reps !== null) {
      return `${weightFromKg(set.weightKg, weightUnit)}${weightUnit} × ${set.reps}`
    }
    if (set.reps !== null) return `${set.reps} reps`
    return '—'
  }

  return (
    <BottomSheet onDismiss={onDismiss} panelClassName="max-h-[90%] overflow-y-auto">
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-surface px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="truncate text-[18px] font-bold tracking-tight">
            {exercise.name}
          </h2>
          {primaryMuscle && (
            <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-ink-secondary">
              <span
                className="size-2 rounded-full"
                style={{
                  background: regionVar(primaryMuscle.region as Region),
                }}
                aria-hidden
              />
              {primaryMuscle.name} · {REGION_LABELS[primaryMuscle.region as Region]}
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

      <div className="space-y-5 px-5 py-4">
        {workoutExerciseId !== undefined && (
          <Section title="Note for this workout">
            <textarea
              value={sessionNoteDraft ?? ''}
              onChange={(event) => setSessionNoteDraft(event.target.value)}
              onBlur={() => {
                if (sessionNoteDraft !== null && sessionNoteDraft !== sessionRow?.notes) {
                  void repo.updateWorkoutExercise(workoutExerciseId, {
                    notes: sessionNoteDraft,
                  })
                }
              }}
              rows={2}
              placeholder="Felt heavy, shoulder tweaked, last set was a grind…"
              className="w-full resize-none rounded-xl border border-line bg-sunken px-3.5 py-2.5 text-[15px] outline-none focus:border-accent focus:bg-surface"
            />
            <p className="mt-1 text-[11.5px] text-ink-muted">
              Stays with this workout only, and shows on the card.
            </p>
          </Section>
        )}

        <Section title={workoutExerciseId ? 'Note for every workout' : 'Notes'}>
          <textarea
            value={noteDraft ?? ''}
            onChange={(event) => setNoteDraft(event.target.value)}
            onBlur={() => {
              if (noteDraft !== null && noteDraft !== exercise.notes) {
                void repo.updateExercise(exerciseId, { notes: noteDraft })
              }
            }}
            rows={2}
            placeholder="Seat height, pin setting, cues…"
            className="w-full resize-none rounded-xl border border-line bg-sunken px-3.5 py-2.5 text-[15px] outline-none focus:border-accent focus:bg-surface"
          />
        </Section>

        {workoutExerciseId && thisSession && (
          <Section title="This session">
            <div className="flex gap-4">
              <Stat label="Sets" value={String(thisSession.sets.length)} />
              <Stat
                label="Volume"
                value={displayWeight(thisSession.volumeKg, weightUnit).toLocaleString()}
              />
              {thisSession.bestE1rmKg !== null && (
                <Stat
                  label="Best e1RM"
                  value={String(displayWeight(thisSession.bestE1rmKg, weightUnit))}
                />
              )}
            </div>
          </Section>
        )}

        <Section title="Details">
          <dl className="space-y-1.5 text-[13.5px]">
            <Row label="Equipment" value={humanizeSlug(exercise.equipment)} />
            <Row label="Tracked as" value={humanizeSlug(exercise.trackingType)} />
            {exercise.isUnilateral && <Row label="Per side" value="Yes" />}
            {exercise.bodyweightFactor !== null && (
              <Row
                label="Bodyweight moved"
                value={`${Math.round(exercise.bodyweightFactor * 100)}%`}
              />
            )}
          </dl>
        </Section>

        {records.length > 0 && (
          <Section title="Records">
            <dl className="space-y-1.5 text-[13.5px]">
              {records.map((record) => (
                <div key={record.id} className="flex justify-between gap-3">
                  <dt className="text-ink-secondary">
                    {RECORD_LABELS[record.recordType]}
                  </dt>
                  <dd className="shrink-0 text-right">
                    <span className="tabular font-semibold">
                      {formatRecordValue(record.recordType, record.value)}
                    </span>
                    <span className="ml-1.5 text-[11.5px] text-ink-muted">
                      {formatRelativeDay(record.achievedAt)}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </Section>
        )}

        {sessions.length > 0 && (
          <Section title="Recent sessions">
            <div className="space-y-2.5">
              {sessions.slice(0, 5).map((session) => (
                <div key={session.workoutId}>
                  <div className="flex items-baseline justify-between">
                    <p className="text-[13px] font-semibold">
                      {formatRelativeDay(session.performedAt)}
                    </p>
                    {session.bestE1rmKg !== null && (
                      <p className="text-[11.5px] text-ink-muted">
                        e1RM {displayWeight(session.bestE1rmKg, weightUnit)}
                      </p>
                    )}
                  </div>
                  <p className="tabular mt-0.5 text-[12.5px] text-ink-secondary">
                    {session.sets.map(describeSet).join(' · ')}
                  </p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {sessions.length === 0 && (
          <p className="text-[13.5px] text-ink-muted">
            No history yet — this will fill in once you log it.
          </p>
        )}

        {onRemoveFromWorkout && (
          <Section title="Actions">
            <button
              onClick={() => {
                onRemoveFromWorkout()
                onDismiss()
              }}
              className="flex w-full items-center gap-2.5 rounded-xl border border-line px-3.5 py-3 text-left text-[14.5px] font-medium text-critical"
            >
              <Trash2 size={17} />
              Remove from this workout
            </button>
          </Section>
        )}
      </div>

      <div className="sticky bottom-0 border-t border-line bg-surface px-4 py-3">
        <Button variant="secondary" size="lg" className="w-full" onClick={onDismiss}>
          Done
        </Button>
      </div>
    </BottomSheet>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
        {title}
      </p>
      {children}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-ink-secondary">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[19px] font-bold leading-tight">{value}</p>
      <p className="text-[11.5px] text-ink-muted">{label}</p>
    </div>
  )
}
