// The Home coach greeting (§5.2.1, §13): regenerated only when the finished-workout
// count changes, so it costs at most one generation per workout, cached per user.

import { getActiveUserId, getCoachSummary } from '@/data/repository'
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

export async function getHomeGreeting(
  finishedWorkoutCount: number,
): Promise<string | null> {
  if (finishedWorkoutCount === 0) return null

  const cached = readCache()
  if (cached && cached.workoutCount === finishedWorkoutCount) return cached.text

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
