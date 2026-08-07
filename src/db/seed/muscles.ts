/**
 * The system muscle library (§4.2). Two levels — region and muscle — so a
 * reverse dumbbell fly tags to Rear Delt under shoulders and lands in shoulder
 * volume instead of polluting chest.
 *
 * IDs are stable slugs rather than random UUIDs so exercise seed data can
 * reference them by name and stay readable.
 */

import type { Region } from '@/domain/types'

export interface MuscleSeed {
  id: string
  name: string
  region: Region
}

export const MUSCLE_SEEDS: MuscleSeed[] = [
  // chest
  { id: 'upper_chest', name: 'Upper Chest', region: 'chest' },
  { id: 'mid_chest', name: 'Mid Chest', region: 'chest' },
  { id: 'lower_chest', name: 'Lower Chest', region: 'chest' },

  // back
  { id: 'lats', name: 'Lats', region: 'back' },
  { id: 'upper_traps', name: 'Upper Traps', region: 'back' },
  { id: 'mid_traps', name: 'Mid Traps', region: 'back' },
  { id: 'lower_traps', name: 'Lower Traps', region: 'back' },
  { id: 'rhomboids', name: 'Rhomboids', region: 'back' },
  { id: 'erectors', name: 'Erectors', region: 'back' },
  { id: 'teres', name: 'Teres', region: 'back' },

  // shoulders
  { id: 'front_delt', name: 'Front Delt', region: 'shoulders' },
  { id: 'side_delt', name: 'Side Delt', region: 'shoulders' },
  { id: 'rear_delt', name: 'Rear Delt', region: 'shoulders' },

  // biceps (elbow flexors + forearms roll up here)
  { id: 'biceps', name: 'Biceps', region: 'biceps' },
  { id: 'brachialis', name: 'Brachialis', region: 'biceps' },
  { id: 'forearms', name: 'Forearms', region: 'biceps' },

  // triceps
  { id: 'triceps', name: 'Triceps', region: 'triceps' },

  // legs
  { id: 'quads', name: 'Quads', region: 'legs' },
  { id: 'hamstrings', name: 'Hamstrings', region: 'legs' },
  { id: 'glutes', name: 'Glutes', region: 'legs' },
  { id: 'adductors', name: 'Adductors', region: 'legs' },
  { id: 'abductors', name: 'Abductors', region: 'legs' },
  { id: 'calves', name: 'Calves', region: 'legs' },

  // core
  { id: 'rectus_abdominis', name: 'Abs', region: 'core' },
  { id: 'obliques', name: 'Obliques', region: 'core' },
  { id: 'transverse_abdominis', name: 'Deep Core', region: 'core' },

  // cardio
  { id: 'cardiovascular', name: 'Cardiovascular', region: 'cardio' },
]

export const REGION_OF_MUSCLE: Record<string, Region> = Object.fromEntries(
  MUSCLE_SEEDS.map((m) => [m.id, m.region]),
)
