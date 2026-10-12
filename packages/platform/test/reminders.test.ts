import { describe, expect, it, vi } from 'vitest'
import { dayAt, reminderId, reminderIds, stillAhead, syncReminders, todayAt } from '../src/reminders'

const now = new Date(2026, 9, 12, 13, 30).getTime()

describe('todayAt', () => {
  it('is a minute from local midnight on the same day', () => {
    expect(new Date(todayAt(9 * 60 + 15, now)).getHours()).toBe(9)
    expect(new Date(todayAt(9 * 60 + 15, now)).getMinutes()).toBe(15)
    expect(new Date(todayAt(0, now)).getDate()).toBe(12)
  })
})

describe('stillAhead', () => {
  it('drops a reminder whose time today has passed', () => {
    const morning = { id: 1, title: 'a', body: '', at: todayAt(9 * 60, now) }
    const evening = { id: 2, title: 'b', body: '', at: todayAt(19 * 60, now) }
    expect(stillAhead([morning, evening], now)).toEqual([evening])
  })
})

describe('syncReminders', () => {
  it('refuses a reminder id the caller does not own', () => {
    expect(() =>
      syncReminders([10, 11], [{ id: 12, title: 'x', body: '', at: now + 1 }], now),
    ).toThrow(/outside/)
  })
})

describe('dayAt', () => {
  it('lands on the same clock time a few days ahead', () => {
    const friday = new Date(dayAt(18 * 60, now, 4))
    expect([friday.getDate(), friday.getHours(), friday.getMinutes()]).toEqual([16, 18, 0])
  })
})

describe('reminderId', () => {
  it('gives every slot and day its own id inside the range', () => {
    const ids = reminderIds(4200, 2)
    expect(ids).toHaveLength(14)
    expect(ids).toContain(reminderId(4200, 1, 6))
    expect(new Set(ids).size).toBe(14)
  })
})

describe('syncReminders on a device', () => {
  it('finishes cancelling before it schedules, so a reschedule is never undone', async () => {
    vi.resetModules()
    const calls: string[] = []
    vi.doMock('../src/detect', () => ({ isNativePlatform: () => true }))
    vi.doMock('@capacitor/local-notifications', () => ({
      LocalNotifications: {
        checkPermissions: async () => ({ display: 'granted' }),
        requestPermissions: async () => ({ display: 'granted' }),
        cancel: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5))
          calls.push('cancel')
        },
        schedule: async () => void calls.push('schedule'),
      },
    }))
    const { syncReminders: sync } = await import('../src/reminders')

    const result = await sync([7], [{ id: 7, title: 't', body: '', at: Date.now() + 60_000 }])

    expect(result).toBe('scheduled')
    expect(calls).toEqual(['cancel', 'schedule'])
  })

  it('says so when notifications are turned off', async () => {
    vi.resetModules()
    vi.doMock('../src/detect', () => ({ isNativePlatform: () => true }))
    vi.doMock('@capacitor/local-notifications', () => ({
      LocalNotifications: {
        checkPermissions: async () => ({ display: 'denied' }),
        requestPermissions: async () => ({ display: 'denied' }),
        cancel: async () => {},
        schedule: async () => {},
      },
    }))
    const { syncReminders: sync } = await import('../src/reminders')
    expect(await sync([7], [{ id: 7, title: 't', body: '', at: Date.now() + 60_000 }])).toBe('denied')
  })
})
