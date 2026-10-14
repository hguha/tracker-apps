import { useEffect, useState } from 'react'
import { plural, weekStreaks } from '@tracker-engine/core'
import { EmptyState, PageTitle, ProgressRing, SectionLabel } from '@tracker-engine/ui'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ChevronRight,
  Flame,
  Play,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import * as repo from '@/data/repository'
import { useAuth } from '@/auth/AuthContext'
import { useSync } from '@/sync/useSync'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { displayWeight, formatDisplayWeight, formatDuration } from '@/lib/units'
import { DAY_MS, WEEK_MS, dayKey, formatRelativeDay, formatTimeOfDay, weekStart } from '@/lib/dates'
import { partOfDay } from '@/lib/sessionTitle'
import { regionVar } from '@/lib/palette'
import { REGION_LABELS, REGIONS, type Profile, type Region } from '@/domain/types'
import { levelFor, nextBadges, type Level } from '@tracker-engine/badges'
import { CelebrationOverlay, useCelebrations, useToday } from '@tracker-engine/ui'
import { evaluateBadges, type BadgeState } from './badges'
import { experience, goalWeeksMet, shownExperience, takeLegacyHighWater } from './progression'
import { BadgeDetailSheet, BadgeTile } from './BadgeUI'
import {
  conditionLabel,
  evaluateAvatar,
  overallCondition,
  WINDOW_DAYS as AVATAR_WINDOW_DAYS,
  type RegionInput,
} from './avatar'
import { TrainingAvatar } from './TrainingAvatar'
import { getHomeGreeting } from '@/features/coach/encouragement'

export function HomeScreen({
  onResumeWorkout,
  onStartWorkout,
  onOpenWorkout,
  onOpenBadges,
  onOpenCoach,
}: {
  onResumeWorkout: (workoutId: string) => void
  onStartWorkout: () => void
  onOpenWorkout: (workoutId: string) => void
  onOpenBadges: () => void
  onOpenCoach: () => void
}) {
  const { session } = useAuth()
  const [greeting, setGreeting] = useState<string | null>(null)
  const today = useToday()

  const data = useLiveQuery(async () => {
    const profile = await repo.getProfile()
    const active = await repo.getActiveWorkout()
    // Pull deep so lifetime badge stats reflect full history, not just the recent window.
    const finished = await repo.listFinishedWorkoutSummaries(1000)

    const thisWeekStart = weekStart(Date.now(), profile.weekStartsOn)
    const lastWeekStart = thisWeekStart - WEEK_MS

    const thisWeek = finished.filter((s) => s.workout.startedAt >= thisWeekStart)
    const lastWeek = finished.filter(
      (s) => s.workout.startedAt >= lastWeekStart && s.workout.startedAt < thisWeekStart,
    )

    const sumVolume = (list: typeof finished) =>
      list.reduce((total, s) => total + s.volumeKg, 0)

    const setsByRegion = new Map<Region, number>()
    const setsByRegionWindow = new Map<Region, number>()

    const avatarWindowStart = Date.now() - AVATAR_WINDOW_DAYS * DAY_MS

    for (const summary of finished) {
      if (summary.workout.startedAt < avatarWindowStart) continue
      const inThisWeek = summary.workout.startedAt >= thisWeekStart
      for (const [region, count] of Object.entries(summary.workingSetsByRegion)) {
        const r = region as Region
        setsByRegionWindow.set(r, (setsByRegionWindow.get(r) ?? 0) + count)
        if (inThisWeek) setsByRegion.set(r, (setsByRegion.get(r) ?? 0) + count)
      }
    }

    const lastTrainedByRegion = new Map<Region, number>()
    for (const summary of finished) {
      for (const region of summary.regions) {
        if (!lastTrainedByRegion.has(region)) {
          lastTrainedByRegion.set(region, summary.workout.startedAt)
        }
      }
    }

    // Days since last trained comes from full history so an old region still decays.
    const avatarInputs = new Map<Region, RegionInput>()
    for (const region of REGIONS) {
      const lastAt = lastTrainedByRegion.get(region)
      avatarInputs.set(region, {
        setsInWindow: setsByRegionWindow.get(region) ?? 0,
        daysSinceTrained:
          lastAt === undefined
            ? null
            : Math.floor((Date.now() - lastAt) / DAY_MS),
      })
    }
    const avatar = evaluateAvatar(avatarInputs)
    const neglected = REGIONS.filter((r) => r !== 'cardio')
      .map((region) => ({ region, lastAt: lastTrainedByRegion.get(region) ?? 0 }))
      .sort((a, b) => a.lastAt - b.lastAt)[0]

    const { current: streakWeeks, best: bestWeekStreak } = weekStreaks(
      finished.map((s) => s.workout.startedAt),
      profile.weekStartsOn,
    )

    const totalVolumeKg = finished.reduce((total, s) => total + s.volumeKg, 0)
    const totalSets = finished.reduce((total, s) => total + s.setCount, 0)

    const badgeStats = await repo.getBadgeStats()
    const goalWeeks = goalWeeksMet(
      finished.map((s) => s.workout.startedAt),
      profile.weekStartsOn,
      Math.max(1, profile.weeklyWorkoutGoal || 4),
    )

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
      badgeStats,
      goalWeeks,
      avatar,
    }
  }, [today])

  // Greeting refreshes only when the workout count changes; getHomeGreeting caches on it.
  const finishedCount = data?.totalWorkouts ?? 0
  useEffect(() => {
    let cancelled = false
    void getHomeGreeting(finishedCount).then((text) => {
      if (!cancelled) setGreeting(text)
    })
    return () => {
      cancelled = true
    }
  }, [finishedCount])

  if (!data) return null

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
    badgeStats,
    goalWeeks,
    avatar,
  } = data

  const unit = profile.unitWeight
  const maxSets = Math.max(6, ...setsByRegion.values())
  const firstName = (session?.displayName ?? '').split(/\s+/)[0]
  const greetName = firstName && firstName !== 'You' ? `, ${firstName}` : ''
  // weeklyWorkoutGoal can be absent; coalesce before Math.max or the ring shows "/NaN".
  const goal = Math.max(1, profile.weeklyWorkoutGoal || 4)

  const badges = evaluateBadges({
    totalWorkouts,
    totalSets,
    totalVolumeKg,
    bestWeekStreak,
    currentWeekStreak: streakWeeks,
    ...badgeStats,
  })

  const earnedXp = experience({ ...badgeStats, goalWeeks })
  const level = levelFor(shownExperience(profile.xpHighWater, earnedXp))

  const deltaPercent =
    lastWeekVolume > 0
      ? Math.round(((thisWeekVolume - lastWeekVolume) / lastWeekVolume) * 100)
      : null

  return (
    <div className="space-y-3 px-3 py-3">
      <PageTitle>
        Good {partOfDay(Date.now()).toLowerCase()}
        {greetName}
      </PageTitle>

      {greeting && (
        <button
          onClick={onOpenCoach}
          className="flex w-full items-start gap-3 rounded-2xl border border-accent/30 bg-accent-wash p-4 text-left active:opacity-80"
        >
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-contrast">
            <Sparkles size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-medium leading-snug text-ink">
              {greeting}
            </span>
            <span className="mt-1 flex items-center gap-0.5 text-[12px] font-semibold text-accent">
              Ask your coach <ChevronRight size={13} />
            </span>
          </span>
        </button>
      )}

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

      {totalWorkouts > 0 && profile.showAvatar && (
        <Card className="flex flex-col items-center p-4">
          <TrainingAvatar fitnesses={avatar} />
          <p className="mt-1 text-[15px] font-bold tracking-tight">
            {conditionLabel(overallCondition(avatar))}
          </p>
          <p className="text-[12px] text-ink-muted">
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
              <SectionLabel className="mt-1">
                Volume this week
              </SectionLabel>
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
            <Stat label="Sets this week" value={String(weeklySets)} />
            <Stat label="Best streak" value={`${bestWeekStreak} wk`} />
          </div>
        </Card>
      )}

      <Celebrations
        badges={badges}
        level={level}
        earnedXp={earnedXp}
        profile={profile}
        owner={session?.userId ?? null}
      />
      {totalWorkouts > 0 && (
        <BadgeStrip badges={badges} level={level} onSeeAll={onOpenBadges} />
      )}

      {setsByRegion.size > 0 && (
        <Card className="p-4">
          <SectionLabel>
            Sets by body part
          </SectionLabel>
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
          <SectionLabel>
            Least recently trained
          </SectionLabel>
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
          <SectionLabel className="px-4 pt-3.5 pb-1">
            Recent
          </SectionLabel>
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
                  {formatTimeOfDay(summary.workout.startedAt)} · {plural(summary.setCount, 'set')}
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
        <Card className="px-4 py-1">
          <EmptyState title="Nothing logged yet">
            Log your first workout and this page starts filling in — weekly volume,
            balance by body part, and what to train next.
          </EmptyState>
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

function Celebrations({
  badges,
  level,
  earnedXp,
  profile,
  owner,
}: {
  badges: BadgeState[]
  level: Level
  earnedXp: number
  profile: Profile
  owner: string | null
}) {
  const { isReconciling } = useSync()

  useEffect(() => {
    if (owner === null) return
    const best = Math.max(takeLegacyHighWater(`reputation.xp.${owner}`), earnedXp)
    if (best > profile.xpHighWater) void repo.updateProfile({ xpHighWater: best })
  }, [owner, earnedXp, profile.xpHighWater])

  const { current, dismiss } = useCelebrations(
    owner === null
      ? null
      : {
          stored: profile.celebrated,
          save: (next) => void repo.updateProfile({ celebrated: next }),
          legacyKey: `reputation.celebrated.${owner}`,
        },
    { badges, level: level.level, day: dayKey(Date.now()), dayComplete: false },
    { isQuiet: isReconciling },
  )
  return current ? <CelebrationOverlay celebration={current} onDone={dismiss} /> : null
}

function BadgeStrip({
  badges,
  level,
  onSeeAll,
}: {
  badges: BadgeState[]
  level: Level
  onSeeAll: () => void
}) {
  const [selected, setSelected] = useState<BadgeState | null>(null)
  const earned = badges.filter((b) => b.earned).length
  const upcoming = nextBadges(badges, 4)
  const progress = (level.xp - level.floor) / (level.next - level.floor)

  return (
    <Card className="p-4">
      <button
        onClick={onSeeAll}
        className="flex w-full items-center gap-3 text-left"
        aria-label={`Level ${level.level}, ${earned} badges earned. See all badges`}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-[14px] font-bold text-accent-contrast">
          {level.level}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-[14px] font-semibold">Level {level.level}</span>
            <span className="tabular text-[11.5px] text-ink-muted">
              {level.xp - level.floor} / {level.next - level.floor} XP
            </span>
          </span>
          <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-sunken">
            <span
              className="block h-full rounded-full bg-accent transition-[width] duration-500"
              style={{ width: `${progress * 100}%` }}
            />
          </span>
        </span>
        <span className="tabular flex shrink-0 items-center gap-0.5 text-[12.5px] text-ink-muted">
          🏅 {earned}
          <ChevronRight size={15} />
        </span>
      </button>

      {upcoming.length > 0 && (
        <>
          <p className="mt-3 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
            Next up
          </p>
          <div className="mt-2 flex gap-2.5 overflow-x-auto pb-1">
            {upcoming.map((badge) => (
              <div key={badge.key} className="w-[76px] shrink-0">
                <BadgeTile badge={badge} showProgress onClick={() => setSelected(badge)} />
              </div>
            ))}
          </div>
        </>
      )}

      {selected && (
        <BadgeDetailSheet badge={selected} onDismiss={() => setSelected(null)} />
      )}
    </Card>
  )
}
