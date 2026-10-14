import { replaceLocalNotifications, type ReplaceResult } from './notify'

export interface Reminder {
  id: number
  title: string
  body: string
  at: number
}

export const DAYS_AHEAD = 7

export function dayAt(minute: number, now: number, dayOffset = 0): number {
  const date = new Date(now)
  date.setDate(date.getDate() + dayOffset)
  date.setHours(Math.floor(minute / 60), minute % 60, 0, 0)
  return date.getTime()
}

export const reminderId = (base: number, slot: number, dayOffset: number): number =>
  base + slot * DAYS_AHEAD + dayOffset

export const reminderIds = (base: number, slots: number): number[] =>
  Array.from({ length: slots * DAYS_AHEAD }, (_, index) => base + index)

export const stillAhead = (reminders: readonly Reminder[], now: number): Reminder[] =>
  reminders.filter((reminder) => reminder.at > now)

export function syncReminders(
  ownedIds: readonly number[],
  due: readonly Reminder[],
  now = Date.now(),
): Promise<ReplaceResult> {
  const owned = new Set(ownedIds)
  const stray = due.find((reminder) => !owned.has(reminder.id))
  if (stray) throw new Error(`Reminder id ${stray.id} is outside this app's range`)
  return replaceLocalNotifications(ownedIds, stillAhead(due, now))
}
