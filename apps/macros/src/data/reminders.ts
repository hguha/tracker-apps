import { dayKey } from '@tracker-engine/core'
import {
  DAYS_AHEAD,
  dayAt,
  reminderId,
  reminderIds,
  syncReminders as syncPlatformReminders,
  type Reminder,
  type ReplaceResult,
} from '@tracker-engine/platform'
import * as repo from '@/data/repository'
import { MEAL_LABELS } from '@/lib/meals'
import { MEAL_SLOTS, type RemindersConfig } from '@/domain/types'

/**
 * "You haven't logged lunch yet" — but only when that is true.
 *
 * The naïve version of this feature is a repeating daily notification, and it is the version that
 * gets notifications switched off: telling somebody who logged lunch two hours ago that they haven't
 * teaches them the alerts are noise, and they lose the ones that would have worked. There is no
 * hook that runs at fire time on either platform, so the condition is enforced the other way round —
 * **every reminder is cancelled and re-scheduled from the current state**, and this runs on boot, on
 * resume, and after every write to the log.
 *
 * Ids are fixed per slot so a reschedule replaces rather than accumulates. They start above the rest
 * timer's range in REPutation's shared `notify` wrapper, which is the only other user of these ids.
 */

const BASE_ID = 4100
const SLOTS = MEAL_SLOTS.length + 2
const END_OF_DAY_SLOT = MEAL_SLOTS.length
const WEIGH_IN_SLOT = MEAL_SLOTS.length + 1
const ALL_IDS = reminderIds(BASE_ID, SLOTS)

/**
 * Brings scheduled reminders in line with what today still needs.
 *
 * Cheap enough to call freely: it reads one day of entries and one profile row, and does nothing at
 * all when reminders are off.
 */
export async function syncReminders(now = Date.now()): Promise<ReplaceResult> {
  return syncPlatformReminders(ALL_IDS, await remindersAhead(now), now)
}

export async function remindersAhead(now: number): Promise<Reminder[]> {
  const profile = await repo.getProfile()
  const config = profile.reminders
  if (!config) return []
  const weighed = new Set((await repo.weights()).map((row) => row.day))
  const days = await Promise.all(
    Array.from({ length: DAYS_AHEAD }, async (_, offset) => {
      const day = dayKey(dayAt(0, now, offset))
      return { offset, day, entries: await repo.entriesForDay(day) }
    }),
  )

  return days.flatMap(({ offset, day, entries }) => {
    const logged = new Set(entries.map((entry) => entry.meal))
    const due: Reminder[] = []

    for (const reminder of config.meals) {
      if (!reminder.enabled || logged.has(reminder.meal)) continue
      due.push({
        id: reminderId(BASE_ID, MEAL_SLOTS.indexOf(reminder.meal), offset),
        title: `${MEAL_LABELS[reminder.meal]} not logged`,
        body: `Add what you had and today's numbers stay right.`,
        at: dayAt(reminder.minute, now, offset),
      })
    }

    if (config.endOfDay.enabled && entries.length === 0) {
      due.push({
        id: reminderId(BASE_ID, END_OF_DAY_SLOT, offset),
        title: 'Nothing logged today',
        body: 'A rough entry beats a blank day — even one line keeps the trend usable.',
        at: dayAt(config.endOfDay.minute, now, offset),
      })
    }

    if (config.weighIn.enabled && !weighed.has(day)) {
      due.push({
        id: reminderId(BASE_ID, WEIGH_IN_SLOT, offset),
        title: 'Weigh-in',
        body: 'One number, and the week has a trend to measure your calories against.',
        at: dayAt(config.weighIn.minute, now, offset),
      })
    }
    return due
  })
}

/** What the settings row shows: how many nudges a day are switched on. */
export function describeReminders(config: RemindersConfig | null): string {
  if (!config) return 'Off'
  const on =
    config.meals.filter((row) => row.enabled).length +
    (config.endOfDay.enabled ? 1 : 0) +
    (config.weighIn.enabled ? 1 : 0)
  return on === 0 ? 'Off' : `${on} a day`
}
