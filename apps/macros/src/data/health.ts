import { readWeightSamples } from '@tracker-engine/platform'
import * as repo from '@/data/repository'

/**
 * The Health import, as a device-local preference.
 *
 * `localStorage` rather than a synced row, because the permission itself is per device: another
 * phone signed into the same account has its own HealthKit grant, and a synced "on" flag would
 * promise an import that device can't perform.
 */
const KEY = 'macros.health.weights'

/** Only ever imports what's new, so opening the app doesn't rewrite months of weigh-ins. */
const WINDOW_DAYS = 180

export const isHealthSyncOn = (): boolean => localStorage.getItem(KEY) === 'on'

export function setHealthSyncOn(on: boolean): void {
  if (on) localStorage.setItem(KEY, 'on')
  else localStorage.removeItem(KEY)
}

export async function syncHealthWeights(): Promise<number> {
  const samples = await readWeightSamples(WINDOW_DAYS)
  if (samples.length === 0) return 0
  return repo.importWeights(samples)
}

/** Runs on boot when the user has turned it on. Failures are silent: a missing import is a
 *  missing convenience, and the app is fully usable without it. */
export async function syncHealthWeightsIfEnabled(): Promise<void> {
  if (!isHealthSyncOn()) return
  try {
    await syncHealthWeights()
  } catch {
    // ignored
  }
}
