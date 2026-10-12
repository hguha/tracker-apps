import { cancelLocalNotification, scheduleLocalNotification } from './notify'

export interface Reminder {
  id: number
  title: string
  body: string
  at: number
}

export function todayAt(minute: number, now: number): number {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  return date.getTime() + minute * 60_000
}

export const stillAhead = (reminders: readonly Reminder[], now: number): Reminder[] =>
  reminders.filter((reminder) => reminder.at > now)

export function syncReminders(
  ownedIds: readonly number[],
  due: readonly Reminder[],
  now = Date.now(),
): void {
  const owned = new Set(ownedIds)
  const stray = due.find((reminder) => !owned.has(reminder.id))
  if (stray) throw new Error(`Reminder id ${stray.id} is outside this app's range`)
  for (const id of ownedIds) cancelLocalNotification(id)
  for (const reminder of stillAhead(due, now)) scheduleLocalNotification(reminder)
}
