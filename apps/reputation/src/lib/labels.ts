/**
 * Enum slugs to display labels.
 *
 * `horizontal_push` → `Horizontal push`. Sentence case, not title case: these are
 * prose labels in tables and detail rows, not headings. There were three copies
 * of this with two different casings, so the same movement pattern read
 * "Horizontal Push" on Insights and "Horizontal push" on the exercise sheet.
 */
export function humanizeSlug(value: string): string {
  const spaced = value.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

import type { Equipment } from '@/domain/types'

// The equipment prefix shown in front of a base movement. Bodyweight and "other"
// add nothing to a name ("Bodyweight Push-up" reads worse than "Push-up"), so
// they carry no prefix.
const EQUIPMENT_PREFIX: Partial<Record<Equipment, string>> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbell',
  machine: 'Machine',
  cable: 'Cable',
  smith: 'Smith Machine',
  kettlebell: 'Kettlebell',
  band: 'Band',
}

// Composes the display name for a logged exercise: "Bench Press" + barbell →
// "Barbell Bench Press". The base name alone when the equipment adds nothing.
export function composeExerciseName(baseName: string, equipment: Equipment): string {
  const prefix = EQUIPMENT_PREFIX[equipment]
  return prefix ? `${prefix} ${baseName}` : baseName
}
