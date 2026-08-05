/**
 * Home (§5.2.1).
 *
 * One job: answer "what should I do right now", then get out of the way.
 * Everything here earns its place by serving that; anything that merely duplicates
 * another tab is gone.
 *
 * Two things changed after first use: recent rows now carry enough to identify a
 * session (they used to read "Workout"), and the week figure carries a delta —
 * a number with no comparison isn't an insight.
 */

import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight, Play, TrendingDown, TrendingUp } from 'lucide-react'
import { db } from '@/db/database'
import * as repo from '@/data/repository'
import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { isWorkingSet } from '@/lib/metrics'
import { formatDuration, weightFromKg } from '@/lib/units'
import { formatRelativeDay, formatTimeOfDay, weekStart } from '@/lib/dates'
import { partOfDay } from '@/lib/sessionTitle'
import { regionVar } from '@/lib/palette'
import { REGION_LABELS, REGIONS, type Region } from '@/domain/types'

const WEEK_MS = 7 * 24 * 3600 * 1000

export function HomeScreen({
  onResumeWorkout,
  onStartWorkout,
  onOpenWorkout,
}: {
  onResumeWorkout: (workoutId: string) => void
  onStartWorkout: () => void
  onOpenWorkout: (workoutId: string) => void
}) {
  const { session } = useAuth()

  const data = useLiveQuery(async () => {
    const profile = await repo.getProfile()
    const active = await repo.getActiveWorkout()
    const summaries = await repo.listWorkoutSummaries(80)
    const finished = summaries.filter((s) => s.workout.endedAt !== null)

    const thisWeekStart = weekStart(Date.now(), profile.weekStartsOn)
    const lastWeekStart = thisWeekStart - WEEK_MS

    const thisWeek = finished.filter((s) => s.workout.startedAt >= thisWeekStart)
    const lastWeek = finished.filter(
      (s) => s.workout.startedAt >= lastWeekStart && s.workout.startedAt < thisWeekStart,
    )

    const sumVolume = (list: typeof finished) =>
      list.reduce((total, s) => total + s.volumeKg, 0)

    // Sets per region this week, for the balance bars.
    const muscles = await db.muscles.toArray()
    const regionOf = new Map(muscles.map((m) => [m.id, m.region]))
    const setsByRegion = new Map<Region, number>()

    for (const summary of thisWeek) {
      for (const we of await repo.listWorkoutExercises(summary.workout.id)) {
        const exercise = await db.exercises.get(we.exerciseId)
        if (!exercise) continue
        const region = regionOf.get(exercise.primaryMuscleId)
        if (!region) continue
        const working = (await repo.listSets(we.id)).filter(
          (s) => s.isCompleted && isWorkingSet(s),
        ).length
        if (working > 0) {
          setsByRegion.set(region, (setsByRegion.get(region) ?? 0) + working)
        }
      }
    }

    // Which region has gone longest without work.
    const lastTrainedByRegion = new Map<Region, number>()
    for (const summary of finished) {
      for (const region of summary.regions) {
        if (!lastTrainedByRegion.has(region)) {
          lastTrainedByRegion.set(region, summary.workout.startedAt)
        }
      }
    }
    const neglected = REGIONS.filter((r) => r !== 'cardio')
      .map((region) => ({ region, lastAt: lastTrainedByRegion.get(region) ?? 0 }))
      .sort((a, b) => a.lastAt - b.lastAt)[0]

    // Consecutive weeks with at least one session, walking back from this week.
    let streakWeeks = 0
    for (let offset = 0; offset < 104; offset += 1) {
      const start = thisWeekStart - offset * WEEK_MS
      const trained = finished.some(
        (s) => s.workout.startedAt >= start && s.workout.startedAt < start + WEEK_MS,
      )
      if (!trained) {
        // This week not being done *yet* shouldn't read as a broken streak.
        if (offset === 0) continue
        break
      }
      streakWeeks += 1
    }

    return {
      profile,
      active,
      recent: finished.slice(0, 3),
      weeklyWorkouts: thisWeek.length,
      thisWeekVolume: sumVolume(thisWeek),
      lastWeekVolume: sumVolume(lastWeek),
      weeklySets: [...setsByRegion.values()].reduce((a, b) => a + b, 0),
      setsByRegion,
      neglected,
      streakWeeks,
      totalWorkouts: finished.length,
    }
  }, [])

  if (!data) return <div className="p-6 text-ink-muted">Loading…</div>

  const {
    profile,
    active,
    recent,
    weeklyWorkouts,
    thisWeekVolume,
    lastWeekVolume,
    weeklySets,
    setsByRegion,
    neglected,
    streakWeeks,
    totalWorkouts,
  } = data

  const unit = profile.unitWeight
  const maxSets = Math.max(6, ...setsByRegion.values())
  const firstName = (session?.displayName ?? 'there').split(/\s+/)[0]

  // Only compare when there is something to compare against — an invented
  // baseline would present a first week as either a triumph or a collapse.
  const deltaPercent =
    lastWeekVolume > 0
      ? Math.round(((thisWeekVolume - lastWeekVolume) / lastWeekVolume) * 100)
      : null

  return (
    <div className="space-y-3 px-3 py-3">
      <div className="px-1 pt-1">
        <h1 className="text-[22px] font-bold tracking-tight">
          Good {partOfDay(Date.now()).toLowerCase()}, {firstName}
        </h1>
      </div>

      {active && (
        <Card className="border-accent bg-accent-wash p-4">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-accent">
            In progress
          </p>
          <p className="mt-0.5 text-[16px] font-semibold">
            Started {formatDuration((Date.now() - active.startedAt) / 1000)} ago
          </p>
          <Button className="mt-3 w-full" onClick={() => onResumeWorkout(active.id)}>
            <Play size={17} />
            Resume
          </Button>
        </Card>
      )}

      {!active && (
        <Button size="lg" className="w-full" onClick={onStartWorkout}>
          Log a workout
        </Button>
      )}

      {totalWorkouts > 0 && (
        <Card className="p-4">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
            This week
          </p>
          {/* A hero figure with proportional figures — not a one-bar chart. */}
          <div className="mt-1 flex items-baseline gap-2">
            <p className="text-[38px] font-bold leading-none tracking-tight">
              {Math.round(weightFromKg(thisWeekVolume, unit)).toLocaleString()}
            </p>
            <span className="text-[15px] font-semibold text-ink-muted">{unit}</span>
          </div>

          {deltaPercent !== null && (
            <p
              className="mt-1.5 flex items-center gap-1 text-[13px] font-semibold"
              style={{
                color: deltaPercent >= 0 ? 'var(--delta-good)' : 'var(--status-serious)',
              }}
            >
              {deltaPercent >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              {deltaPercent >= 0 ? '+' : ''}
              {deltaPercent}% vs last week
            </p>
          )}

          <div className="mt-3 flex gap-5">
            <Stat label="Workouts" value={String(weeklyWorkouts)} />
            <Stat label="Sets" value={String(weeklySets)} />
            <Stat label="Week streak" value={String(streakWeeks)} />
          </div>
        </Card>
      )}

      {setsByRegion.size > 0 && (
        <Card className="p-4">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
            Sets by body part
          </p>
          <div className="mt-3 space-y-2">
            {REGIONS.filter((region) => setsByRegion.has(region)).map((region) => {
              const count = setsByRegion.get(region) ?? 0
              return (
                <div key={region} className="flex items-center gap-2.5">
                  <span className="w-20 shrink-0 text-[13px] text-ink-secondary">
                    {REGION_LABELS[region]}
                  </span>
                  <div className="h-5 flex-1 overflow-hidden rounded-md bg-sunken">
                    <div
                      className="h-full rounded-md"
                      style={{
                        width: `${(count / maxSets) * 100}%`,
                        background: regionVar(region),
                      }}
                    />
                  </div>
                  {/* Direct label — the bar's color can't be the only carrier. */}
                  <span className="tabular w-6 shrink-0 text-right text-[13px] font-semibold">
                    {count}
                  </span>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {neglected && neglected.lastAt > 0 && (
        <Card className="p-4">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
            Next up
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[15px]">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: regionVar(neglected.region) }}
              aria-hidden
            />
            <span className="font-semibold">{REGION_LABELS[neglected.region]}</span>
            <span className="text-ink-secondary">
              — last trained {formatRelativeDay(neglected.lastAt)}
            </span>
          </p>
        </Card>
      )}

      {recent.length > 0 && (
        <Card className="overflow-hidden">
          <p className="px-4 pt-3.5 pb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
            Recent
          </p>
          {recent.map((summary) => (
            <button
              key={summary.workout.id}
              onClick={() => onOpenWorkout(summary.workout.id)}
              className="flex w-full items-start gap-3 border-t border-line px-4 py-3 text-left active:bg-accent-wash"
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
                  <span className="truncate text-[15px] font-medium">{summary.title}</span>
                </span>
                <span className="tabular mt-0.5 block text-[12.5px] text-ink-muted">
                  {formatRelativeDay(summary.workout.startedAt)} ·{' '}
                  {formatTimeOfDay(summary.workout.startedAt)} · {summary.setCount} sets
                  {summary.volumeKg > 0 &&
                    ` · ${Math.round(
                      weightFromKg(summary.volumeKg, unit),
                    ).toLocaleString()} ${unit}`}
                </span>
              </span>
              <ChevronRight size={17} className="mt-1 shrink-0 text-ink-muted" />
            </button>
          ))}
        </Card>
      )}

      {totalWorkouts === 0 && !active && (
        <Card className="p-5 text-center">
          <p className="text-[15px] font-semibold">Nothing logged yet</p>
          <p className="mt-1 text-[13.5px] text-ink-secondary">
            Log your first workout and this page starts filling in — weekly volume,
            balance by body part, and what to train next.
          </p>
        </Card>
      )}
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
