import { dayKey } from '@tracker-engine/core'
import { cancelLocalNotification, scheduleLocalNotification } from '@tracker-engine/platform'
import * as repo from '@/data/repository'
import { MEAL_LABELS } from '@/lib/meals'
import { MEAL_SLOTS, type MealSlot, type RemindersConfig } from '@/domain/types'

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
const idFor = (meal: MealSlot): number => BASE_ID + MEAL_SLOTS.indexOf(meal)
const END_OF_DAY_ID = BASE_ID + MEAL_SLOTS.length
const WEIGH_IN_ID = BASE_ID + MEAL_SLOTS.length + 1

const ALL_IDS = [...MEAL_SLOTS.map(idFor), END_OF_DAY_ID, WEIGH_IN_ID]

/** Today, at a minute from local midnight. */
function todayAt(minute: number, now: number): number {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  return date.getTime() + minute * 60_000
}

/**
 * Brings scheduled reminders in line with what today still needs.
 *
 * Cheap enough to call freely: it reads one day of entries and one profile row, and does nothing at
 * all when reminders are off.
 */
export async function syncReminders(now = Date.now()): Promise<void> {
  for (const id of ALL_IDS) cancelLocalNotification(id)

  const profile = await repo.getProfile()
  const config = profile.reminders
  if (!config) return

  const day = dayKey(now)
  const entries = await repo.entriesForDay(day)
  const logged = new Set(entries.map((entry) => entry.meal))

  for (const reminder of config.meals) {
    if (!reminder.enabled || logged.has(reminder.meal)) continue
    const at = todayAt(reminder.minute, now)
    // Already past means the nudge for today has been missed; tomorrow's is scheduled by the next
    // boot or resume rather than by a repeat rule, which is what keeps the condition honest.
    if (at <= now) continue
    scheduleLocalNotification({
      id: idFor(reminder.meal),
      title: `${MEAL_LABELS[reminder.meal]} not logged`,
      body: `Add what you had and today's numbers stay right.`,
      at,
    })
  }

  if (config.endOfDay.enabled && entries.length === 0) {
    const at = todayAt(config.endOfDay.minute, now)
    if (at > now) {
      scheduleLocalNotification({
        id: END_OF_DAY_ID,
        title: 'Nothing logged today',
        body: 'A rough entry beats a blank day — even one line keeps the trend usable.',
        at,
      })
    }
  }

  // Same rule as the meals: only if it hasn't happened. A weigh-in is the one input the app can't
  // derive from anything else — no trend means no measured expenditure, and no target after week two.
  if (config.weighIn.enabled) {
    const weighed = (await repo.weights()).some((row) => row.day === day)
    const at = todayAt(config.weighIn.minute, now)
    if (!weighed && at > now) {
      scheduleLocalNotification({
        id: WEIGH_IN_ID,
        title: 'Weigh-in',
        body: 'One number, and the week has a trend to measure your calories against.',
        at,
      })
    }
  }
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
