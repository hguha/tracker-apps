import type { Goal } from '@/domain/types'

/** %/week of bodyweight. Named rather than free-numeric, because the difference between −0.5
 *  and −1.5 is the difference between sustainable and miserable, and a slider invites the latter. */
export const RATES: Record<Goal, { value: number; label: string }[]> = {
  lose: [
    { value: -0.25, label: 'Gentle' },
    { value: -0.5, label: 'Steady' },
    { value: -0.75, label: 'Fast' },
  ],
  gain: [
    { value: 0.125, label: 'Lean' },
    { value: 0.25, label: 'Steady' },
    { value: 0.5, label: 'Fast' },
  ],
  maintain: [{ value: 0, label: 'Hold' }],
}

export function paceLabel(goal: Goal, ratePctPerWeek: number): string | null {
  return RATES[goal].find((rate) => rate.value === ratePctPerWeek)?.label ?? null
}
