import { DAY_MS } from '@tracker-engine/core'
import * as repo from '@/data/repository'
import { lastCompleteWeekKey } from '@/lib/checkin'

/**
 * Runs the weekly check-in for every week the history covers, oldest first.
 *
 * `runCheckIn` only ever looks at the week that just ended, which is right for a live app but
 * leaves imported or demo history with no targets at all. Oldest-first matters: each week's
 * expenditure filter seeds from the previous week's conclusion, so running them out of order
 * would produce a different — and less settled — answer than living through them would have.
 */
export async function runCheckInsForHistory(weeksBack = 8): Promise<number> {
  let created = 0
  const seen = new Set((await repo.checkIns()).map((c) => c.weekStart))

  for (let offset = weeksBack; offset >= 0; offset -= 1) {
    const at = Date.now() - offset * 7 * DAY_MS
    if (seen.has(lastCompleteWeekKey(at))) continue
    const checkIn = await repo.runCheckIn(at)
    if (checkIn) {
      seen.add(checkIn.weekStart)
      created += 1
    }
  }
  return created
}
