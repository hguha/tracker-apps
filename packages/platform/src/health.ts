import { isNativePlatform } from './detect'

/**
 * Reading bodyweight from Apple Health / Health Connect.
 *
 * Deliberately narrow: **weight only, read-only**. The temptation with a health integration is to
 * pull active energy and add it to the day's budget, which would double-count — a measured
 * expenditure already contains training, and crediting it twice is the fastest way to make a
 * calorie app wrong. Steps and workouts are therefore not read at all, so there's nothing to
 * misuse later.
 *
 * A no-op on the web, where there is no such API: every function resolves to "unavailable" rather
 * than throwing, so a caller needs no platform check of its own.
 */

export interface WeightSample {
  /** Local calendar day, `yyyy-MM-dd`. */
  day: string
  kg: number
  at: number
  /** Which app or device wrote it — a scale, another tracker, or Health itself. */
  source: string
  /** True when a person typed it into Health rather than a device recording it. */
  isManual: boolean
}

export async function isHealthAvailable(): Promise<boolean> {
  if (!isNativePlatform()) return false
  try {
    const { Health } = await import('capacitor-health')
    const { available } = await Health.isHealthAvailable()
    return available
  } catch {
    return false
  }
}

/**
 * Asks for read access to weight.
 *
 * iOS can't report whether the user granted it — HealthKit deliberately hides denial so an app
 * can't infer anything from the absence of data — so this returns whether the prompt completed,
 * and the caller has to treat "no samples" as the ordinary case rather than an error.
 */
export async function requestWeightAccess(): Promise<boolean> {
  if (!isNativePlatform()) return false
  try {
    const { Health } = await import('capacitor-health')
    await Health.requestHealthPermissions({ permissions: ['READ_WEIGHT'] })
    return true
  } catch {
    return false
  }
}

/** Every weight sample in the window, newest last. Empty when unavailable or not granted. */
export async function readWeightSamples(sinceDays = 180): Promise<WeightSample[]> {
  if (!isNativePlatform()) return []
  try {
    const { Health } = await import('capacitor-health')
    const end = new Date()
    const start = new Date(end.getTime() - sinceDays * 86_400_000)
    const { records } = await Health.queryRecords({
      dataType: 'weight',
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    })

    return records
      .map((record) => {
        const at = Date.parse(record.startDate)
        return {
          day: localDay(at),
          kg: record.value,
          at,
          source: record.sourceName || 'Apple Health',
          isManual: record.manual,
        }
      })
      .filter((sample) => Number.isFinite(sample.at) && sample.kg > 0)
      .sort((a, b) => a.at - b.at)
  } catch {
    return []
  }
}

/** Local, not UTC: a 7am weigh-in must not land on the previous day west of Greenwich. */
function localDay(at: number): string {
  const date = new Date(at)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Opens iOS Settings for this app, the only route to changing a denied HealthKit permission. */
export async function openHealthSettings(): Promise<void> {
  if (!isNativePlatform()) return
  try {
    const { Health } = await import('capacitor-health')
    await Health.openAppleHealthSettings()
  } catch {
    // Nothing to do: the button is a convenience, not a requirement.
  }
}
