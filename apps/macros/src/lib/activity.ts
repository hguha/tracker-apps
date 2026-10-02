import type { ActivityLevel } from '@/domain/types'

/**
 * What each activity bucket means, in terms of a week rather than a number.
 *
 * The multiplier is deliberately not shown to the user: "1.55" is the model's business, and asking
 * somebody to choose between 1.375 and 1.55 is asking them to calibrate a formula they can't see.
 * The descriptions are concrete enough to place yourself in without arithmetic.
 */
export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: 'Mostly sitting',
  light: 'Lightly active',
  moderate: 'Moderately active',
  active: 'Very active',
  athlete: 'Athlete or heavy labour',
}

export const ACTIVITY_DETAILS: Record<ActivityLevel, string> = {
  sedentary: 'Desk job, little deliberate exercise',
  light: 'On your feet some of the day, or training 1–2 times a week',
  moderate: 'Training 3–5 times a week, or an active job',
  active: 'Training 6–7 times a week, or a physical job',
  athlete: 'Twice-daily training, or heavy manual work',
}

