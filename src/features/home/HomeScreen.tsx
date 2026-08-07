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
import { ChevronRight, Flame, Play, TrendingDown, TrendingUp } from 'lucide-react'
import { db } from '@/db/database'
import * as repo from '@/data/repository'
import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { ProgressRing } from '@/components/ProgressRing'
import { isWorkingSet } from '@/lib/metrics'
import { displayWeight, formatDisplayWeight, formatDuration } from '@/lib/units'
import { formatRelativeDay, formatTimeOfDay, weekStart } from '@/lib/dates'
import { partOfDay } from '@/lib/sessionTitle'
import { regionVar } from '@/lib/palette'
import { REGION_LABELS, REGIONS, type Region } from '@/domain/types'
import { evaluateBadges, type BadgeState } from './badges'
import {
  conditionLabel,
  evaluateAvatar,
  overallCondition,
  WINDOW_DAYS as AVATAR_WINDOW_DAYS,
  type RegionInput,
} from './avatar'
import { TrainingAvatar } from './TrainingAvatar'

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
    // Pull deep so lifetime badge stats (total workouts, volume, best streak)
    // reflect real history, not just the recent window.
    const summaries = await repo.listWorkoutSummaries(1000)
    const finished = summaries.filter((s) => s.workout.endedAt !== null)

    const thisWeekStart = weekStart(Date.now(), profile.weekStartsOn)
    const lastWeekStart = thisWeekStart - WEEK_MS

    const thisWeek = finished.filter((s) => s.workout.startedAt >= thisWeekStart)
    const lastWeek = finished.filter(
      (s) => s.workout.startedAt >= lastWeekStart && s.workout.startedAt < thisWeekStart,
    )

    const sumVolume = (list: typeof finished) =>
      list.reduce((total, s) => total + s.volumeKg, 0)

    // Working sets per region, both this week (balance bars) and over the
    // avatar's trailing window (§avatar). One pass over the window's workouts —
    // this-week is a subset, so it's bucketed rather than queried twice.
    const muscles = await db.muscles.toArray()
    const regionOf = new Map(muscles.map((m) => [m.id, m.region]))
    const setsByRegion = new Map<Region, number>()
    const setsByRegionWindow = new Map<Region, number>()

    const avatarWindowStart = Date.now() - AVATAR_WINDOW_DAYS * 24 * 3600 * 1000
    const windowWorkouts = finished.filter(
      (s) => s.workout.startedAt >= avatarWindowStart,
    )

    for (const summary of windowWorkouts) {
      const inThisWeek = summary.workout.startedAt >= thisWeekStart
      for (const we of await repo.listWorkoutExercises(summary.workout.id)) {
        const exercise = await db.exercises.get(we.exerciseId)
        if (!exercise) continue
        const region = regionOf.get(exercise.primaryMuscleId)
        if (!region) continue
        const working = (await repo.listSets(we.id)).filter(
          (s) => s.isCompleted && isWorkingSet(s),
        ).length
        if (working > 0) {
          setsByRegionWindow.set(region, (setsByRegionWindow.get(region) ?? 0) + working)
          if (inThisWeek)
            setsByRegion.set(region, (setsByRegion.get(region) ?? 0) + working)
        }
      }
    }

    // Which region has gone longest without work — also the avatar's "days
    // since trained" per region.
    const lastTrainedByRegion = new Map<Region, number>()
    for (const summary of finished) {
      for (const region of summary.regions) {
        if (!lastTrainedByRegion.has(region)) {
          lastTrainedByRegion.set(region, summary.workout.startedAt)
        }
      }
    }

    // Assemble the avatar's per-region inputs (§avatar): work in the window plus
    // days since last trained (from full history, so an old region still decays).
    const avatarInputs = new Map<Region, RegionInput>()
    for (const region of REGIONS) {
      const lastAt = lastTrainedByRegion.get(region)
      avatarInputs.set(region, {
        setsInWindow: setsByRegionWindow.get(region) ?? 0,
        daysSinceTrained:
          lastAt === undefined
            ? null
            : Math.floor((Date.now() - lastAt) / (24 * 3600 * 1000)),
      })
    }
    const avatar = evaluateAvatar(avatarInputs)
    const neglected = REGIONS.filter((r) => r !== 'cardio')
      .map((region) => ({ region, lastAt: lastTrainedByRegion.get(region) ?? 0 }))
      .sort((a, b) => a.lastAt - b.lastAt)[0]

    // Whether each week (walking back from this one) had a session. Shared by
    // the current-streak count and the best-ever streak for badges.
    const trainedThisWeekAt = (start: number) =>
      finished.some(
        (s) => s.workout.startedAt >= start && s.workout.startedAt < start + WEEK_MS,
      )

    // Current streak: consecutive trained weeks ending now. This week not being
    // done *yet* shouldn't read as a broken streak, so a blank current week is
    // skipped rather than counted as a break.
    let streakWeeks = 0
    for (let offset = 0; offset < 520; offset += 1) {
      const trained = trainedThisWeekAt(thisWeekStart - offset * WEEK_MS)
      if (!trained) {
        if (offset === 0) continue
        break
      }
      streakWeeks += 1
    }

    // Best streak ever: longest run of consecutive trained weeks anywhere in
    // history. Walk from the earliest session's week forward to this week.
    let bestWeekStreak = streakWeeks
    if (finished.length > 0) {
      const earliest = Math.min(...finished.map((s) => s.workout.startedAt))
      const firstWeek = weekStart(earliest, profile.weekStartsOn)
      let run = 0
      for (let start = firstWeek; start <= thisWeekStart; start += WEEK_MS) {
        if (trainedThisWeekAt(start)) {
          run += 1
          if (run > bestWeekStreak) bestWeekStreak = run
        } else {
          run = 0
        }
      }
    }

    const totalVolumeKg = finished.reduce((total, s) => total + s.volumeKg, 0)
    const totalSets = finished.reduce((total, s) => total + s.setCount, 0)

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
      bestWeekStreak,
      totalWorkouts: finished.length,
      totalVolumeKg,
      totalSets,
      avatar,
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
    bestWeekStreak,
    totalWorkouts,
    totalVolumeKg,
    totalSets,
    avatar,
  } = data

  const unit = profile.unitWeight
  const maxSets = Math.max(6, ...setsByRegion.values())
  const firstName = (session?.displayName ?? 'there').split(/\s+/)[0]
  const goal = Math.max(1, profile.weeklyWorkoutGoal)

  const badges = evaluateBadges({
    totalWorkouts,
    totalSets,
    totalVolumeKg,
    bestWeekStreak,
    currentWeekStreak: streakWeeks,
  })

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
        <Card className="flex flex-col items-center p-4">
          <TrainingAvatar fitnesses={avatar} />
          <p className="mt-1 text-[15px] font-bold tracking-tight">
            {conditionLabel(overallCondition(avatar))}
          </p>
          <p className="text-[12px] text-ink-muted">
            {/* Name the region that most needs work, so the figure suggests an
                action rather than just judging. */}
            {(() => {
              const weakest = avatar
                .filter((a) => a.region !== 'cardio')
                .sort((a, b) => a.fitness - b.fitness)[0]
              return weakest && weakest.fitness < 0.75
                ? `${REGION_LABELS[weakest.region]} could use some work`
                : 'Every body part is in shape — nice'
            })()}
          </p>
        </Card>
      )}

      {totalWorkouts > 0 && (
        <Card className="p-4">
          <div className="flex items-center gap-4">
            {/* The weekly goal ring — the day-to-day thing to close. Turns
                green once the goal is met, for a clear completion signal. */}
            <ProgressRing
              value={weeklyWorkouts}
              max={goal}
              size={104}
              strokeWidth={11}
              color={weeklyWorkouts >= goal ? 'var(--status-good)' : 'var(--accent)'}
            >
              <span className="text-[26px] font-bold leading-none tabular">
                {weeklyWorkouts}
                <span className="text-[15px] font-semibold text-ink-muted">/{goal}</span>
              </span>
              <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                this week
              </span>
            </ProgressRing>

            <div className="min-w-0 flex-1">
              {streakWeeks > 0 && (
                <p
                  className="flex items-center gap-1 text-[15px] font-bold"
                  style={{ color: 'var(--region-biceps)' }}
                >
                  <Flame size={16} />
                  {streakWeeks} week streak
                </p>
              )}
              <p className="mt-1 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
                Volume this week
              </p>
              <div className="flex items-baseline gap-1.5">
                <span className="text-[24px] font-bold leading-tight tracking-tight">
                  {displayWeight(thisWeekVolume, unit).toLocaleString()}
                </span>
                <span className="text-[13px] font-semibold text-ink-muted">{unit}</span>
              </div>
              {deltaPercent !== null && (
                <p
                  className="flex items-center gap-1 text-[12.5px] font-semibold"
                  style={{
                    color:
                      deltaPercent >= 0 ? 'var(--delta-good)' : 'var(--status-serious)',
                  }}
                >
                  {deltaPercent >= 0 ? (
                    <TrendingUp size={13} />
                  ) : (
                    <TrendingDown size={13} />
                  )}
                  {deltaPercent >= 0 ? '+' : ''}
                  {deltaPercent}% vs last week
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 flex gap-5 border-t border-line pt-3">
            <Stat label="Workouts" value={String(weeklyWorkouts)} />
            <Stat label="Sets" value={String(weeklySets)} />
            <Stat label="Best streak" value={`${bestWeekStreak} wk`} />
          </div>
        </Card>
      )}

      {totalWorkouts > 0 && <BadgeStrip badges={badges} />}

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
                  <span className="truncate text-[15px] font-medium">
                    {summary.title}
                  </span>
                </span>
                <span className="tabular mt-0.5 block text-[12.5px] text-ink-muted">
                  {formatRelativeDay(summary.workout.startedAt)} ·{' '}
                  {formatTimeOfDay(summary.workout.startedAt)} · {summary.setCount} sets
                  {summary.volumeKg > 0 &&
                    ` · ${formatDisplayWeight(summary.volumeKg, unit)}`}
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

/**
 * The badges strip: earned badges plus the next one to chase.
 *
 * Earned badges render filled; the single nearest unearned badge renders with
 * its progress caption, so there's always a visible next goal without turning
 * the whole catalog into a wall of locked tiles.
 */
function BadgeStrip({ badges }: { badges: BadgeState[] }) {
  const earned = badges.filter((b) => b.earned)
  const next = badges.find((b) => !b.earned)
  // The set to show: everything earned, then the nearest unearned as the target.
  const shown = next ? [...earned, next] : earned
  if (shown.length === 0) return null

  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
          Badges
        </p>
        <p className="text-[12px] text-ink-muted">
          {earned.length} of {badges.length}
        </p>
      </div>
      <div className="mt-3 flex gap-2.5 overflow-x-auto pb-1">
        {shown.map((badge) => (
          <div
            key={badge.key}
            className="flex w-[76px] shrink-0 flex-col items-center gap-1 text-center"
          >
            <span
              className={
                'flex size-14 items-center justify-center rounded-2xl text-[26px] ' +
                (badge.earned ? 'bg-accent-wash' : 'bg-sunken opacity-45 grayscale')
              }
              title={badge.caption}
            >
              {badge.icon}
            </span>
            <span className="text-[11px] font-semibold leading-tight">{badge.label}</span>
            {!badge.earned && (
              <span className="tabular text-[10.5px] text-ink-muted">
                {badge.detailText}
              </span>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}
