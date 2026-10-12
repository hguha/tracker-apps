import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_REMINDERS,
  describeReminders,
  readReminders,
  remindersDue,
  writeReminders,
} from '@/features/reminders/reminders'

const monday = new Date(2026, 9, 12, 9, 0).getTime()
const tuesday = new Date(2026, 9, 13, 9, 0).getTime()
const quiet = { trained: false, weekGoalMet: false, weighed: false }
const idle = Array.from({ length: 7 }, () => quiet)
const todayIs = (state: Partial<typeof quiet>) => [{ ...quiet, ...state }, ...idle.slice(1)]
const onToday = (reminders: { at: number; title: string; id: number }[], now: number) =>
  reminders.filter((r) => new Date(r.at).getDate() === new Date(now).getDate())
const both = {
  workout: { enabled: true, minute: 18 * 60, weekdays: [1] },
  weighIn: { enabled: true, minute: 20 * 60 },
}

beforeEach(() => localStorage.clear())

describe('remindersDue', () => {
  it('is silent when reminders are off', () => {
    expect(remindersDue(null, idle, monday)).toEqual([])
  })

  it('nudges a workout only on a picked day with nothing trained', () => {
    expect(onToday(remindersDue(both, idle, monday), monday).map((r) => r.title)).toContain('No workout yet today')
    expect(onToday(remindersDue(both, idle, tuesday), tuesday).map((r) => r.title)).not.toContain(
      'No workout yet today',
    )
    expect(onToday(remindersDue(both, todayIs({ trained: true }), monday), monday).map((r) => r.title)).toEqual([
      'Weigh-in',
    ])
  })

  it('stops the workout nudge once the weekly goal is met', () => {
    expect(
      onToday(remindersDue(both, todayIs({ weekGoalMet: true }), monday), monday).map((r) => r.title),
    ).toEqual(['Weigh-in'])
  })

  it('skips the weigh-in after one is recorded today', () => {
    expect(
      onToday(remindersDue(both, todayIs({ weighed: true }), monday), monday).map((r) => r.title),
    ).toEqual(['No workout yet today'])
  })
})

describe('remindersDue across the week', () => {
  it('schedules the next picked day even if the app is not opened that day', () => {
    const mondayEvening = new Date(2026, 9, 12, 19, 0).getTime()
    const wednesday = { ...both, workout: { ...both.workout, weekdays: [3] } }
    const workouts = remindersDue(wednesday, idle, mondayEvening).filter(
      (r) => r.title === 'No workout yet today',
    )
    expect(workouts.map((r) => new Date(r.at).getDay())).toEqual([3])
    expect(new Date(workouts[0]!.at).getHours()).toBe(18)
  })

  it('gives each day its own notification id', () => {
    const daily = { ...both, workout: { ...both.workout, weekdays: [0, 1, 2, 3, 4, 5, 6] } }
    const ids = remindersDue(daily, idle, monday).map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toHaveLength(14)
  })
})

describe('stored preferences per account', () => {
  it('are not inherited by the next account on this device', async () => {
    const { setActiveUserId } = await import('@/db/seed')
    setActiveUserId('first')
    writeReminders(DEFAULT_REMINDERS)
    setActiveUserId('second')
    expect(readReminders()).toBeNull()
    setActiveUserId('first')
    expect(readReminders()).toEqual(DEFAULT_REMINDERS)
  })
})

describe('stored preferences', () => {
  it('start off, and round-trip once set', () => {
    expect(readReminders()).toBeNull()
    expect(describeReminders(readReminders())).toBe('Off')
    writeReminders(DEFAULT_REMINDERS)
    expect(readReminders()).toEqual(DEFAULT_REMINDERS)
    expect(describeReminders(readReminders())).toBe('1 on')
    writeReminders(null)
    expect(readReminders()).toBeNull()
  })
})
