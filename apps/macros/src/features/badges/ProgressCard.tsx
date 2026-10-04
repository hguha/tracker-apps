import { useCallback, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { cn } from '@tracker-engine/core'
import { Card, ProgressRing } from '@tracker-engine/ui'
import { Check, ChevronRight, Droplet, Drumstick, Scale, Utensils } from 'lucide-react'
import { nutritionStats } from '@/data/stats'
import { evaluateBadges } from './catalog'
import { CelebrationOverlay } from './CelebrationOverlay'
import {
  celebrationsSince,
  experience,
  levelFor,
  nextBadges,
  type Celebrated,
  type Celebration,
  type DailyGoal,
  type DailyGoalKey,
} from './progression'

const GOAL_ICONS: Record<DailyGoalKey, typeof Utensils> = {
  log: Utensils,
  protein: Drumstick,
  water: Droplet,
  weigh: Scale,
}

const storageKey = (owner: string) => `macros.celebrated.${owner}`

function readCelebrated(owner: string): Celebrated | null {
  try {
    const raw = localStorage.getItem(storageKey(owner))
    return raw ? (JSON.parse(raw) as Celebrated) : null
  } catch {
    return null
  }
}

export function ProgressCard({
  owner,
  day,
  goals,
  onOpenBadges,
}: {
  owner: string | null
  day: string
  goals: DailyGoal[] | null
  onOpenBadges: () => void
}) {
  const stats = useLiveQuery(() => nutritionStats(), [], undefined)
  const [queue, setQueue] = useState<Celebration[]>([])

  const badges = stats ? evaluateBadges(stats) : []
  const level = stats ? levelFor(experience(stats)) : null
  const dayComplete = goals !== null && goals.length > 0 && goals.every((goal) => goal.done)

  useEffect(() => {
    if (!stats || !level || goals === null || owner === null) return
    const { celebrations, next } = celebrationsSince(readCelebrated(owner), {
      badges,
      level: level.level,
      day,
      dayComplete,
    })
    localStorage.setItem(storageKey(owner), JSON.stringify(next))
    if (celebrations.length > 0) setQueue((current) => [...current, ...celebrations])
  }, [stats, goals === null, dayComplete, day, owner])

  const dismiss = useCallback(() => setQueue((current) => current.slice(1)), [])

  if (!stats || !level) return null
  const earned = badges.filter((badge) => badge.earned).length
  const upcoming = nextBadges(badges, 4)

  return (
    <Card className="p-0">
      <button
        onClick={onOpenBadges}
        className="flex w-full items-center gap-3 px-4 pb-2 pt-3 text-left active:bg-sunken"
        aria-label={`Level ${level.level}, ${earned} badges earned`}
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
              style={{ width: `${((level.xp - level.floor) / (level.next - level.floor)) * 100}%` }}
            />
          </span>
        </span>
        <span className="tabular flex shrink-0 items-center gap-0.5 text-[12.5px] text-ink-muted">
          🏅 {earned}
          <ChevronRight size={15} />
        </span>
      </button>

      {goals !== null && (
        <ul className="flex justify-between gap-2 px-4 py-2" aria-label="Today's goals">
          {goals.map((goal) => {
            const Icon = GOAL_ICONS[goal.key]
            return (
              <li
                key={goal.key}
                className="flex min-w-0 flex-1 flex-col items-center gap-1"
                aria-label={`${goal.label} ${goal.done ? 'done' : 'not yet'}`}
              >
                <span
                  className={cn(
                    'relative flex size-9 items-center justify-center rounded-full transition-colors',
                    goal.done ? 'bg-accent text-accent-contrast' : 'bg-sunken text-ink-muted',
                  )}
                >
                  <Icon size={16} />
                  {goal.done && (
                    <Check
                      size={11}
                      strokeWidth={3}
                      className="absolute -right-0.5 -top-0.5 rounded-full bg-surface text-accent"
                    />
                  )}
                </span>
                <span className="truncate text-[10.5px] text-ink-muted">{goal.label}</span>
              </li>
            )
          })}
        </ul>
      )}

      {upcoming.length > 0 && (
        <div className="flex gap-3 overflow-x-auto border-t border-line px-4 pb-3 pt-2.5">
          {upcoming.map((badge) => (
            <button
              key={badge.key}
              onClick={onOpenBadges}
              className="flex w-[64px] shrink-0 flex-col items-center gap-1 text-center"
              aria-label={`${badge.label} — ${badge.detailText}`}
            >
              <ProgressRing value={badge.fraction} max={1} size={48} strokeWidth={4}>
                <span className="text-[20px]">{badge.icon}</span>
              </ProgressRing>
              <span className="line-clamp-2 text-[10.5px] font-medium leading-tight">
                {badge.label}
              </span>
            </button>
          ))}
        </div>
      )}

      {queue[0] && <CelebrationOverlay celebration={queue[0]} onDone={dismiss} />}
    </Card>
  )
}
