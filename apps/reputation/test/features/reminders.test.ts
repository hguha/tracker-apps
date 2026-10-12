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
const idle = { trainedToday: false, weekGoalMet: false, weighedToday: false }
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
    expect(remindersDue(both, idle, monday).map((r) => r.title)).toContain('No workout yet today')
    expect(remindersDue(both, idle, tuesday).map((r) => r.title)).not.toContain(
      'No workout yet today',
    )
    expect(remindersDue(both, { ...idle, trainedToday: true }, monday).map((r) => r.id)).toEqual([
      4201,
    ])
  })

  it('stops the workout nudge once the weekly goal is met', () => {
    expect(
      remindersDue(both, { ...idle, weekGoalMet: true }, monday).map((r) => r.title),
    ).toEqual(['Weigh-in'])
  })

  it('skips the weigh-in after one is recorded today', () => {
    expect(
      remindersDue(both, { ...idle, weighedToday: true }, monday).map((r) => r.title),
    ).toEqual(['No workout yet today'])
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
