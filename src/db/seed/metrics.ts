/**
 * Seed biomarker definitions (§4.9).
 *
 * `higherIsBetter: null` is meaningful, not lazy — bodyweight rising is
 * neither good nor bad without knowing the user's goal, and the charts read
 * this field to decide whether to color a delta at all.
 */

import type { MetricCategory, MetricUnitType } from '@/domain/types'

export interface MetricSeed {
  key: string
  label: string
  unitType: MetricUnitType
  category: MetricCategory
  higherIsBetter: boolean | null
  precision: number
}

export const METRIC_SEEDS: MetricSeed[] = [
  // body composition
  { key: 'bodyweight', label: 'Bodyweight', unitType: 'mass', category: 'body_composition', higherIsBetter: null, precision: 1 },
  { key: 'height', label: 'Height', unitType: 'length', category: 'body_composition', higherIsBetter: null, precision: 1 },
  { key: 'body_fat_pct', label: 'Body Fat', unitType: 'percent', category: 'body_composition', higherIsBetter: false, precision: 1 },
  { key: 'lean_mass', label: 'Lean Mass', unitType: 'mass', category: 'body_composition', higherIsBetter: true, precision: 1 },

  // circumferences
  { key: 'neck', label: 'Neck', unitType: 'length', category: 'circumference', higherIsBetter: null, precision: 1 },
  { key: 'shoulders', label: 'Shoulders', unitType: 'length', category: 'circumference', higherIsBetter: null, precision: 1 },
  { key: 'chest', label: 'Chest', unitType: 'length', category: 'circumference', higherIsBetter: null, precision: 1 },
  { key: 'waist', label: 'Waist', unitType: 'length', category: 'circumference', higherIsBetter: false, precision: 1 },
  { key: 'hips', label: 'Hips', unitType: 'length', category: 'circumference', higherIsBetter: null, precision: 1 },
  { key: 'bicep_l', label: 'Bicep (L)', unitType: 'length', category: 'circumference', higherIsBetter: true, precision: 1 },
  { key: 'bicep_r', label: 'Bicep (R)', unitType: 'length', category: 'circumference', higherIsBetter: true, precision: 1 },
  { key: 'forearm_l', label: 'Forearm (L)', unitType: 'length', category: 'circumference', higherIsBetter: true, precision: 1 },
  { key: 'forearm_r', label: 'Forearm (R)', unitType: 'length', category: 'circumference', higherIsBetter: true, precision: 1 },
  { key: 'thigh_l', label: 'Thigh (L)', unitType: 'length', category: 'circumference', higherIsBetter: true, precision: 1 },
  { key: 'thigh_r', label: 'Thigh (R)', unitType: 'length', category: 'circumference', higherIsBetter: true, precision: 1 },
  { key: 'calf_l', label: 'Calf (L)', unitType: 'length', category: 'circumference', higherIsBetter: true, precision: 1 },
  { key: 'calf_r', label: 'Calf (R)', unitType: 'length', category: 'circumference', higherIsBetter: true, precision: 1 },

  // vitals
  { key: 'resting_hr', label: 'Resting HR', unitType: 'count', category: 'vitals', higherIsBetter: false, precision: 0 },
  { key: 'hrv', label: 'HRV', unitType: 'count', category: 'vitals', higherIsBetter: true, precision: 0 },
  { key: 'blood_pressure_sys', label: 'Blood Pressure (systolic)', unitType: 'count', category: 'vitals', higherIsBetter: false, precision: 0 },
  { key: 'blood_pressure_dia', label: 'Blood Pressure (diastolic)', unitType: 'count', category: 'vitals', higherIsBetter: false, precision: 0 },
  { key: 'sleep_hours', label: 'Sleep', unitType: 'duration', category: 'vitals', higherIsBetter: true, precision: 1 },

  // performance
  { key: 'vo2max', label: 'VO2 Max', unitType: 'count', category: 'performance', higherIsBetter: true, precision: 1 },

  // subjective — 1-10 scales
  { key: 'sleep_quality', label: 'Sleep Quality', unitType: 'count', category: 'subjective', higherIsBetter: true, precision: 0 },
  { key: 'mood', label: 'Mood', unitType: 'count', category: 'subjective', higherIsBetter: true, precision: 0 },
  { key: 'soreness', label: 'Soreness', unitType: 'count', category: 'subjective', higherIsBetter: false, precision: 0 },
  { key: 'stress', label: 'Stress', unitType: 'count', category: 'subjective', higherIsBetter: false, precision: 0 },
]
