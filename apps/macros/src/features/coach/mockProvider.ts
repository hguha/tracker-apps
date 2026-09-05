import { dayKey } from '@tracker-engine/core'
import { trendChangePerWeek, weightTrend } from '@tracker-engine/body'
import * as repo from '@/data/repository'
import { dayTotals, mgToGrams, remaining } from '@/lib/nutrition'
import type { CoachChatResult, CoachProvider, GeminiContent } from './types'

/**
 * The offline coach. Always available, no key, no network.
 *
 * It exists for two reasons: the app must stay useful with no backend configured, and the
 * Gemini free tier is rate-limited — so this is the fallback rather than an error message.
 * It answers from the same repository the live coach's tools read, so the numbers agree; it
 * just can't hold a conversation.
 */
export const mockCoachProvider: CoachProvider = {
  name: 'Offline coach',

  async isAvailable() {
    return true
  },

  // Context is ignored: this reads the repository directly, so it always has the real
  // numbers rather than a summary.
  async chat(contents: GeminiContent[]): Promise<CoachChatResult> {
    const question = lastUserText(contents).toLowerCase()

    if (/weigh|weight|scale|trend/.test(question)) return { text: await weightAnswer(), action: null }
    if (/protein/.test(question)) return { text: await proteinAnswer(), action: null }
    if (/expend|tdee|burn|metabolis/.test(question)) {
      return { text: await expenditureAnswer(), action: null }
    }
    if (/eat|dinner|lunch|hungry|left|remaining|snack/.test(question)) {
      return { text: await remainingAnswer(), action: null }
    }
    return { text: await summaryAnswer(), action: null }
  },
}

function lastUserText(contents: GeminiContent[]): string {
  for (let i = contents.length - 1; i >= 0; i -= 1) {
    const turn = contents[i]
    if (turn?.role === 'user') return turn.parts.map((p) => p.text ?? '').join(' ')
  }
  return ''
}

async function remainingAnswer(): Promise<string> {
  const totals = dayTotals(await repo.entriesForDay(dayKey(Date.now())))
  const targets = await repo.currentTargets()
  if (!targets) {
    return "You don't have a target yet — set a goal in Settings and log a weigh-in, and I'll work one out."
  }
  const left = remaining(totals, targets)
  if (left.kcal <= 0) {
    return `You're ${Math.abs(left.kcal)} kcal over today's ${targets.kcal}. One day doesn't matter; the weekly average is what moves the trend.`
  }
  return `${left.kcal} kcal and ${Math.round(mgToGrams(Math.max(0, left.proteinMg)))} g of protein left today. Protein first — it's the target a deficit squeezes hardest.`
}

async function weightAnswer(): Promise<string> {
  const trend = weightTrend(await repo.weights())
  const latest = trend[trend.length - 1]
  if (!latest) return 'No weigh-ins yet. Weigh in most mornings and I can measure what you burn.'
  const rate = trendChangePerWeek(trend)
  const direction = rate === null ? 'holding' : rate > 0.05 ? 'rising' : rate < -0.05 ? 'falling' : 'flat'
  return `Trend is ${latest.trendKg.toFixed(1)} kg and ${direction}${
    rate === null ? '' : ` at ${rate >= 0 ? '+' : ''}${rate.toFixed(2)} kg/week`
  }. Last reading was ${latest.kg.toFixed(1)} kg — the trend is what to judge by; a single morning swings on water alone.`
}

async function proteinAnswer(): Promise<string> {
  const program = await repo.activeProgram()
  const targets = await repo.currentTargets()
  if (!targets || !program) return 'Set a goal in Settings and I can give you a protein target.'
  return `Your protein target is ${Math.round(mgToGrams(targets.proteinMg))} g/day, from ${program.proteinGPerKg} g per kg of your weight trend. It's a floor, not a ceiling.`
}

async function expenditureAnswer(): Promise<string> {
  const checkIn = await repo.latestCheckIn()
  if (!checkIn) {
    return 'Not enough data to measure your expenditure yet — I need a week with at least four days logged and three weigh-ins.'
  }
  return `Measured at ${checkIn.expenditureKcal} ± ${checkIn.expenditureSe} kcal/day, from your weight trend and what you logged. That already includes your training, which is why nothing gets added on top for exercise.`
}

async function summaryAnswer(): Promise<string> {
  const totals = dayTotals(await repo.entriesForDay(dayKey(Date.now())))
  return `I'm the offline coach, so I answer from your own numbers rather than a conversation. Today: ${totals.kcal} kcal, ${Math.round(mgToGrams(totals.proteinMg))} g protein. Ask me about what's left, your weight trend, protein, or your expenditure.`
}
