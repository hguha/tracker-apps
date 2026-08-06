/**
 * The finish summary (§6.4).
 *
 * Shows what the session actually amounted to, then offers to keep it as a
 * template — the moment right after finishing is when the user knows whether
 * the session was worth repeating.
 */

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/database'
import * as repo from '@/data/repository'
import { Button } from '@/components/Button'
import { useToast } from '@/components/Toast'
import { REGION_LABELS, type Region } from '@/domain/types'
import { isWorkingSet, volumeLoadKg } from '@/lib/metrics'
import { convertWeight, formatDuration } from '@/lib/units'
import { regionVar } from '@/lib/palette'

export function FinishSheet({
  workoutId,
  onDismiss,
  onFinished,
}: {
  workoutId: string
  onDismiss: () => void
  onFinished: (outcome: 'saved' | 'discarded-empty') => void
}) {
  const toast = useToast()
  const [templateName, setTemplateName] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const summary = useLiveQuery(async () => {
    const workout = await repo.getWorkout(workoutId)
    if (!workout) return null

    const profile = await repo.getProfile()
    const workoutExercises = await repo.listWorkoutExercises(workoutId)
    const muscles = await db.muscles.toArray()
    const regionOf = new Map(muscles.map((m) => [m.id, m.region]))

    let totalVolumeKg = 0
    let workingSets = 0
    let completedSets = 0
    let cardioSeconds = 0
    // One lift → its single primary body part (task simplification). Secondary
    // spreading is kept only for the detailed muscle-volume charts.
    const byRegionMap = new Map<Region, number>()

    for (const we of workoutExercises) {
      const exercise = await db.exercises.get(we.exerciseId)
      if (!exercise) continue
      const sets = (await repo.listSets(we.id)).filter((s) => s.isCompleted)
      completedSets += sets.length
      workingSets += sets.filter((s) => isWorkingSet(s)).length
      // Only genuine cardio, not a weighted carry or a plank, both of which
      // also carry a duration.
      if (exercise.movementPattern === 'cardio') {
        cardioSeconds += sets.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0)
      }

      const exerciseVolume = volumeLoadKg(sets, exercise, workout.bodyweightKg)
      totalVolumeKg += exerciseVolume

      const region = regionOf.get(exercise.primaryMuscleId)
      if (region) byRegionMap.set(region, (byRegionMap.get(region) ?? 0) + exerciseVolume)
    }

    const byRegion = byRegionMap

    return {
      workout,
      profile,
      totalVolumeKg,
      workingSets,
      completedSets,
      cardioSeconds,
      // Drop zero-volume regions: cardio has no volume load by definition
      // (§8.1), so listing it at 0% in a volume breakdown is misleading.
      byRegion: [...byRegion].filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]),
      isFromTemplate: workout.templateId !== null,
      exerciseCount: workoutExercises.length,
    }
  }, [workoutId])

  if (!summary) return null

  const {
    workout,
    profile,
    totalVolumeKg,
    workingSets,
    completedSets,
    byRegion,
    cardioSeconds,
  } = summary
  const durationSeconds = (Date.now() - workout.startedAt) / 1000
  const totalRegionVolume = byRegion.reduce((sum, [, value]) => sum + value, 0)

  // Nothing logged means there is nothing to save (§6.4.1). The sheet says so
  // rather than offering to "finish" a session that will be thrown away.
  const isEmpty = completedSets === 0

  async function finish() {
    setIsSaving(true)
    try {
      if (!isEmpty && templateName.trim()) {
        await repo.saveWorkoutAsTemplate(workoutId, templateName.trim())
      }
      const outcome = await repo.finishWorkout(workoutId)
      toast.show(
        outcome === 'discarded-empty'
          ? 'Empty workout discarded'
          : 'Workout saved',
      )
      onFinished(outcome)
    } finally {
      setIsSaving(false)
    }
  }

  if (isEmpty) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40">
        <div className="rounded-t-3xl bg-surface p-5 pb-safe">
          <h2 className="text-[20px] font-bold tracking-tight">
            Nothing logged yet
          </h2>
          <p className="mt-2 text-[14px] text-ink-secondary">
            This workout has no sets, so there's nothing to save. Log a set to keep
            it, or discard it — an empty workout would just clutter your history and
            skew your averages.
          </p>
          <div className="mt-5 flex gap-2">
            <Button variant="secondary" size="lg" className="flex-1" onClick={onDismiss}>
              Keep logging
            </Button>
            <Button
              variant="danger"
              size="lg"
              className="flex-1"
              disabled={isSaving}
              onClick={() => void finish()}
            >
              Discard
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40">
      <div className="max-h-[88%] overflow-y-auto rounded-t-3xl bg-surface pb-safe">
        <div className="px-5 pt-5">
          <h2 className="text-[20px] font-bold tracking-tight">Session complete</h2>

          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <StatTile label="Duration" value={formatDuration(durationSeconds)} />
            <StatTile label="Sets" value={String(workingSets)} />
            {totalVolumeKg > 0 && (
              <StatTile
                label="Volume"
                value={`${Math.round(convertWeight(totalVolumeKg, profile.unitWeight)).toLocaleString()} ${profile.unitWeight}`}
              />
            )}
            {/* Cardio time is reported on its own, never folded into volume. */}
            {cardioSeconds > 0 && (
              <StatTile label="Cardio time" value={formatDuration(cardioSeconds)} />
            )}
          </div>

          {byRegion.length > 0 && (
            <div className="mt-5">
              <p className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
                Where the work went
              </p>
              {/* A 100% stacked bar rather than a pie: length is read accurately,
                  angle is not, and regions are often close in size. */}
              <div className="flex h-3 gap-[2px] overflow-hidden rounded-full">
                {byRegion.map(([region, value]) => (
                  <div
                    key={region}
                    style={{
                      width: `${(value / totalRegionVolume) * 100}%`,
                      background: regionVar(region as Region),
                    }}
                    title={`${REGION_LABELS[region as Region]}`}
                  />
                ))}
              </div>
              {/* Direct labels, not color alone — three light-mode region colors
                  are below 3:1 contrast, so identity can't rest on the swatch. */}
              <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1.5">
                {byRegion.map(([region, value]) => (
                  <span key={region} className="flex items-center gap-1.5 text-[12.5px]">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ background: regionVar(region as Region) }}
                      aria-hidden
                    />
                    <span className="text-ink-secondary">
                      {REGION_LABELS[region as Region]}
                    </span>
                    <span className="tabular text-ink-muted">
                      {Math.round((value / totalRegionVolume) * 100)}%
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {!summary.isFromTemplate && summary.exerciseCount > 0 && (
            <div className="mt-5">
              <p className="mb-1.5 text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
                Save as a template
              </p>
              <input
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
                placeholder="Optional — e.g. Pull A"
                className="h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-[16px] outline-none focus:border-accent"
              />
            </div>
          )}
        </div>

        <div className="sticky bottom-0 mt-5 flex gap-2 border-t border-line bg-surface px-4 py-3">
          <Button variant="secondary" size="lg" onClick={onDismiss} className="flex-1">
            Keep going
          </Button>
          <Button
            size="lg"
            className="flex-[2]"
            disabled={isSaving}
            onClick={() => void finish()}
          >
            Finish
          </Button>
        </div>
      </div>
    </div>
  )
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-sunken px-3.5 py-2.5">
      <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      {/* Proportional figures on a standalone number — tabular looks loose here. */}
      <p className="mt-0.5 text-[21px] font-bold leading-tight">{value}</p>
    </div>
  )
}
