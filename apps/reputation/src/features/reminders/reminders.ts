import { useEffect } from 'react'
import { liveQuery } from 'dexie'
import { syncReminders, todayAt, type Reminder } from '@tracker-engine/platform'
import * as repo from '@/data/repository'
import { dayStart, weekStart } from '@/lib/dates'

export interface ReminderPrefs {
  workout: { enabled: boolean; minute: number; weekdays: number[] }
  weighIn: { enabled: boolean; minute: number }
}

export const DEFAULT_REMINDERS: ReminderPrefs = {
  workout: { enabled: true, minute: 18 * 60, weekdays: [1, 3, 5] },
  weighIn: { enabled: false, minute: 8 * 60 },
}

const KEY = 'reputation.reminders'
const WORKOUT_ID = 4200
const WEIGH_IN_ID = 4201
const OWNED_IDS = [WORKOUT_ID, WEIGH_IN_ID]

export function readReminders(): ReminderPrefs | null {
  const raw = localStorage.getItem(KEY)
  return raw === null ? null : (JSON.parse(raw) as ReminderPrefs)
}

export function writeReminders(prefs: ReminderPrefs | null): void {
  if (prefs === null) localStorage.removeItem(KEY)
  else localStorage.setItem(KEY, JSON.stringify(prefs))
}

export interface TodayState {
  trainedToday: boolean
  weekGoalMet: boolean
  weighedToday: boolean
}

export function remindersDue(prefs: ReminderPrefs | null, state: TodayState, now: number): Reminder[] {
  if (prefs === null) return []
  const due: Reminder[] = []
  const { workout, weighIn } = prefs
  if (
    workout.enabled &&
    workout.weekdays.includes(new Date(now).getDay()) &&
    !state.trainedToday &&
    !state.weekGoalMet
  ) {
    due.push({
      id: WORKOUT_ID,
      title: 'No workout yet today',
      body: 'Even a short session keeps the week on track.',
      at: todayAt(workout.minute, now),
    })
  }
  if (weighIn.enabled && !state.weighedToday) {
    due.push({
      id: WEIGH_IN_ID,
      title: 'Weigh-in',
      body: 'One number keeps bodyweight lifts and your trend accurate.',
      at: todayAt(weighIn.minute, now),
    })
  }
  return due
}

async function todayState(now: number): Promise<TodayState> {
  const profile = await repo.getProfile()
  const today = dayStart(now)
  const thisWeek = weekStart(now, profile.weekStartsOn)
  const workouts = (await repo.listWorkouts(50)).filter((w) => w.startedAt >= thisWeek)
  const finishedThisWeek = workouts.filter((w) => w.endedAt !== null).length
  const weights = await repo.listMetricEntries('bodyweight', 5)
  return {
    trainedToday: workouts.some((w) => w.startedAt >= today),
    weekGoalMet: finishedThisWeek >= Math.max(1, profile.weeklyWorkoutGoal || 4),
    weighedToday: weights.some((entry) => entry.measuredAt >= today),
  }
}

export async function syncWorkoutReminders(now = Date.now()): Promise<void> {
  const prefs = readReminders()
  syncReminders(OWNED_IDS, prefs === null ? [] : remindersDue(prefs, await todayState(now), now), now)
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
      return `${workouts[0]?.id ?? ''}|${weights[0]?.id ?? ''}`
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
