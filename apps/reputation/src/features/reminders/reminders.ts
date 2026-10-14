import { useEffect } from 'react'
import { liveQuery } from 'dexie'
import {
  DAYS_AHEAD,
  dayAt,
  reminderId,
  reminderIds,
  syncReminders,
  type Reminder,
  type ReplaceResult,
} from '@tracker-engine/platform'
import * as repo from '@/data/repository'
import { dayStart, weekStart } from '@/lib/dates'
import { weeklyGoalOf } from '@/domain/types'

export interface ReminderPrefs {
  workout: { enabled: boolean; minute: number; weekdays: number[] }
  weighIn: { enabled: boolean; minute: number }
}

export const DEFAULT_REMINDERS: ReminderPrefs = {
  workout: { enabled: true, minute: 18 * 60, weekdays: [1, 3, 5] },
  weighIn: { enabled: false, minute: 8 * 60 },
}

const keyFor = (userId: string) => `reputation.reminders.${userId}`
const BASE_ID = 4200
const WORKOUT_SLOT = 0
const WEIGH_IN_SLOT = 1
const OWNED_IDS = reminderIds(BASE_ID, 2)

export function readReminders(): ReminderPrefs | null {
  const raw = localStorage.getItem(keyFor(repo.getActiveUserId()))
  return raw === null ? null : (JSON.parse(raw) as ReminderPrefs)
}

export function writeReminders(prefs: ReminderPrefs | null): void {
  const key = keyFor(repo.getActiveUserId())
  if (prefs === null) localStorage.removeItem(key)
  else localStorage.setItem(key, JSON.stringify(prefs))
}

export interface DayState {
  trained: boolean
  weekGoalMet: boolean
  weighed: boolean
}

export function remindersDue(
  prefs: ReminderPrefs | null,
  days: readonly DayState[],
  now: number,
): Reminder[] {
  if (prefs === null) return []
  const { workout, weighIn } = prefs
  return days.flatMap((state, offset) => {
    const due: Reminder[] = []
    const weekday = new Date(dayAt(0, now, offset)).getDay()
    if (workout.enabled && workout.weekdays.includes(weekday) && !state.trained && !state.weekGoalMet) {
      due.push({
        id: reminderId(BASE_ID, WORKOUT_SLOT, offset),
        title: 'No workout yet today',
        body: 'Even a short session keeps the week on track.',
        at: dayAt(workout.minute, now, offset),
      })
    }
    if (weighIn.enabled && !state.weighed) {
      due.push({
        id: reminderId(BASE_ID, WEIGH_IN_SLOT, offset),
        title: 'Weigh-in',
        body: 'One number keeps bodyweight lifts and your trend accurate.',
        at: dayAt(weighIn.minute, now, offset),
      })
    }
    return due
  })
}

async function upcomingDays(now: number): Promise<DayState[]> {
  const profile = await repo.getProfile()
  const today = dayStart(now)
  const thisWeek = weekStart(now, profile.weekStartsOn)
  const workouts = (await repo.listWorkouts(50)).filter((w) => w.startedAt >= thisWeek)
  const goalMetThisWeek =
    workouts.filter((w) => w.endedAt !== null).length >= weeklyGoalOf(profile)
  const weights = await repo.listMetricEntries('bodyweight', 5)
  return Array.from({ length: DAYS_AHEAD }, (_, offset) => {
    const start = dayStart(dayAt(0, now, offset))
    const end = dayStart(dayAt(0, now, offset + 1))
    const inThisWeek = weekStart(start, profile.weekStartsOn) === thisWeek
    return {
      trained: offset === 0 && workouts.some((w) => w.startedAt >= today),
      weekGoalMet: inThisWeek && goalMetThisWeek,
      weighed: weights.some((entry) => entry.measuredAt >= start && entry.measuredAt < end),
    }
  })
}

export async function syncWorkoutReminders(now = Date.now()): Promise<ReplaceResult> {
  const prefs = readReminders()
  const due = prefs === null ? [] : remindersDue(prefs, await upcomingDays(now), now)
  return syncReminders(OWNED_IDS, due, now)
}

export function describeReminders(prefs: ReminderPrefs | null): string {
  if (prefs === null) return 'Off'
  const on = (prefs.workout.enabled ? 1 : 0) + (prefs.weighIn.enabled ? 1 : 0)
  return on === 0 ? 'Off' : `${on} on`
}

export function useReminderSync(isReady: boolean): void {
  useEffect(() => {
    if (!isReady) return
    const sync = () => {
      void syncWorkoutReminders().catch((error) => console.warn('[reminders] sync failed', error))
    }
    const subscription = liveQuery(async () => {
      const [workouts, weights] = await Promise.all([
        repo.listWorkouts(1),
        repo.listMetricEntries('bodyweight', 1),
      ])
      return `${workouts[0]?.id ?? ''}:${workouts[0]?.endedAt ?? ''}|${weights[0]?.id ?? ''}`
    }).subscribe({
      next: sync,
      error: (error) => console.warn('[reminders] observer failed', error),
    })
    const onVisible = () => {
      if (document.visibilityState === 'visible') sync()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      subscription.unsubscribe()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [isReady])
}
