import { dayKey } from '@tracker-engine/core'
import { syncStamp } from '@tracker-engine/local-first'
import { db } from '@/db'
import { enqueue, patch } from '@/data/outbox'
import {
  DEFAULT_REMINDERS,
  type MacroTargets,
  type Profile,
  type RemindersConfig,
} from '@/domain/types'
import { activeUserId } from './internal'

function defaultProfile(userId: string): Profile {
  return {
    id: userId,
    displayName: 'You',
    units: 'metric',
    theme: 'default',
    colorScheme: 'system',
    accentOverride: null,
    heightCm: null,
    birthYear: null,
    sex: null,
    onboardedAt: null,
    onboardingVersion: 0,
    dietNotes: '',
    eatingWindow: null,
    activity: null,
    favouriteFoodIds: [],
    waterTargetMl: null,
    manualTargets: null,
    reminders: null,
    ...syncStamp(),
  }
}

/**
 * Read-only, and it must stay that way: this is read from live queries, and Dexie throws
 * "readwrite transaction in liveQuery context" if a querier writes. Returns an unsaved default
 * when there's no row yet; `ensureProfile` is what creates it, from the boot effect.
 */
export async function getProfile(): Promise<Profile> {
  const row = await db.profiles.get(activeUserId)
  if (!row) return defaultProfile(activeUserId)
  // Fields added after launch are absent on older rows: `.map` on undefined throws, and every
  // `=== null` check reads `undefined` as "set" — the bug that produced `NaN lb goal`.
  return {
    ...row,
    favouriteFoodIds: row.favouriteFoodIds ?? [],
    waterTargetMl: row.waterTargetMl ?? null,
    manualTargets: row.manualTargets ?? null,
    // The weigh-in nudge arrived after the config did, so a row written before it has no such key —
    // and `config.weighIn.enabled` on undefined throws rather than reading as off.
    reminders: row.reminders
      ? { ...row.reminders, weighIn: row.reminders.weighIn ?? DEFAULT_REMINDERS.weighIn }
      : null,
    activity: row.activity ?? null,
  }
}

/**
 * Saves or unsaves a food.
 *
 * Named `toggleSaved` because there is one word for this now. A starred food used to be "pinned" and
 * a kept meal "saved" — two words for one idea, so it was impossible to guess where either would
 * turn up. The stored field keeps its old name; renaming a synced column buys nothing.
 *
 * Newest first, so the list reads as "what I've been eating lately" rather than as an archive, and
 * capped — a saved list of ninety is the frequents list with extra steps.
 */
export async function toggleSaved(foodId: string): Promise<void> {
  const current = (await getProfile()).favouriteFoodIds
  const next = current.includes(foodId)
    ? current.filter((id) => id !== foodId)
    : [foodId, ...current].slice(0, 60)
  await saveProfile({ favouriteFoodIds: next })
}

/** Creates the profile row if absent. Boot-effect only — never call this from a query. */
export async function ensureProfile(): Promise<Profile> {
  const existing = await db.profiles.get(activeUserId)
  if (existing) return existing
  const created = defaultProfile(activeUserId)
  await db.profiles.put(created)
  await enqueue('profiles', created.id)
  return created
}

export async function saveProfile(changes: Partial<Profile>): Promise<void> {
  await ensureProfile()
  await patch('profiles', activeUserId, changes as Record<string, unknown>)
}

export function setWaterTarget(ml: number | null): Promise<void> {
  return saveProfile({ waterTargetMl: ml })
}

export function setReminders(reminders: RemindersConfig | null): Promise<void> {
  return saveProfile({ reminders })
}

/**
 * Sets or clears targets by hand.
 *
 * Stamped with today, so it governs from now on and leaves what's already been scored alone — see
 * `ManualTargets`. Null goes back to the measured target, which is still being computed underneath
 * the whole time.
 */
export function setManualTargets(targets: MacroTargets | null): Promise<void> {
  return saveProfile({
    manualTargets: targets === null ? null : { ...targets, fromDay: dayKey(Date.now()) },
  })
}
