import { dayKey } from '@tracker-engine/core'
import * as repo from '@/data/repository'
import { buildDemoPlan, DEMO_DAYS } from '@/lib/demoData'
import { runCheckInsForHistory } from '@/data/backfill'

/**
 * Loads the demo history into this device.
 *
 * Everything goes through the repository, so demo rows are indistinguishable from real ones —
 * they sync, they're editable, and they exercise exactly the code paths a real user does. A
 * fixture that bypassed the write path would prove nothing.
 */
export async function loadDemoData(): Promise<{ days: number; entries: number }> {
  const plan = buildDemoPlan()

  await repo.saveProfile({
    heightCm: plan.profile.heightCm,
    birthYear: plan.profile.birthYear,
    sex: plan.profile.sex,
    dietNotes: plan.profile.dietNotes,
    onboardedAt: Date.now(),
    onboardingVersion: 1,
  })

  const existing = await repo.activeProgram()
  if (!existing) await repo.startProgram(plan.program)

  let entries = 0
  for (const day of plan.days) {
    if (day.weightKg !== null) await repo.recordWeight(day.weightKg, day.day)

    for (const entry of day.entries) {
      const [food] = await repo.searchFoods(entry.foodQuery, 1)
      if (!food) continue
      await repo.logFood({
        food,
        grams: entry.grams,
        meal: entry.meal,
        day: day.day,
        // Midday-ish, so ordering within a meal is stable and the coach sees sane times.
        eatenAt: Date.parse(`${day.day}T12:00:00`),
        source: 'search',
      })
      entries += 1
    }
  }

  // Run the weekly check-ins the history earns, so Insights and the target aren't empty.
  await runCheckInsForHistory()

  return { days: DEMO_DAYS, entries }
}

export const isDemoLoaded = async (): Promise<boolean> =>
  (await repo.entriesForDay(dayKey(Date.now()))).length > 0
