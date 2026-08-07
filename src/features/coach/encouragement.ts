/**
 * The Home coach greeting (§5.2.1, §13).
 *
 * A warm 1–2 sentence progress note shown on Home. The rule that makes it feel
 * intentional rather than noisy: it regenerates **only after a new workout is
 * finished**, not on every app open. We key the cached note on the finished-
 * workout count — when that number goes up, the old note is stale and we fetch a
 * fresh one; otherwise the cached text is shown instantly with no model call.
 *
 * Cached in localStorage per active user so it survives reloads and costs one
 * generation per workout at most. Uses the live coach when available, the
 * offline mock otherwise — same fallback discipline as the coach screen.
 */

import { getActiveUserId } from '@/db/seed'
import { getCoachSummary } from '@/data/repository'
import { geminiCoachProvider } from './geminiProvider'
import { mockCoachProvider } from './mockProvider'

interface CachedGreeting {
  /** Finished-workout count this note was generated for. */
  workoutCount: number
  text: string
}

function cacheKey(): string {
  return `fitnote.coachGreeting.${getActiveUserId()}`
}

function readCache(): CachedGreeting | null {
  try {
    const raw = localStorage.getItem(cacheKey())
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return typeof parsed?.workoutCount === 'number' && typeof parsed?.text === 'string'
      ? parsed
      : null
  } catch {
    return null
  }
}

function writeCache(value: CachedGreeting): void {
  try {
    localStorage.setItem(cacheKey(), JSON.stringify(value))
  } catch {
    // A full/blocked storage just means we regenerate next time — not fatal.
  }
}

/**
 * The greeting to show on Home, or null when there's nothing to say yet.
 *
 * Returns the cached note immediately when it matches the current workout count.
 * Only when a new workout has been finished since the cached note does it call
 * the coach for a fresh one; a failed call falls back to the mock, and a total
 * failure returns the stale cached text rather than nothing.
 */
export async function getHomeGreeting(
  finishedWorkoutCount: number,
): Promise<string | null> {
  if (finishedWorkoutCount === 0) return null

  const cached = readCache()
  if (cached && cached.workoutCount === finishedWorkoutCount) return cached.text

  // A new workout happened (or no cache yet) — generate a fresh note.
  let text: string
  try {
    const summary = await getCoachSummary()
    const provider = (await geminiCoachProvider.isAvailable())
      ? geminiCoachProvider
      : mockCoachProvider
    try {
      const res = await provider.respond(summary, { kind: 'encouragement' })
      text = res.kind === 'answer' ? res.text : ''
    } catch {
      const res = await mockCoachProvider.respond(summary, { kind: 'encouragement' })
      text = res.kind === 'answer' ? res.text : ''
    }
  } catch {
    // Couldn't even build the summary — keep any stale note rather than blank.
    return cached?.text ?? null
  }

  if (!text) return cached?.text ?? null
  writeCache({ workoutCount: finishedWorkoutCount, text })
  return text
}
