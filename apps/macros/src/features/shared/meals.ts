import type { MealSlot } from '@/domain/types'

/** One spelling of the meal names, so no two screens disagree about them. */
export const MEAL_LABELS: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
}

/** The meal a bare "log food" tap starts on — a default, never a silent assumption: every
 *  logging path shows the picker, because the slot is what the coach reads for timing. */
export function mealForHour(hour: number): MealSlot {
  if (hour < 11) return 'breakfast'
  if (hour < 15) return 'lunch'
  if (hour < 21) return 'dinner'
  return 'snack'
}
