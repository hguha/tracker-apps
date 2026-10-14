import { dayKey } from '@tracker-engine/core'
import type { BodyWeight } from './weight'

export interface WeightReading {
  id: string
  at: number
  kg: number
  updatedAt: number
  deletedAt: number | null
}

export function dailyWeights(readings: readonly WeightReading[], source: string): BodyWeight[] {
  const byDay = new Map<string, WeightReading>()
  for (const reading of readings) {
    if (reading.deletedAt !== null) continue
    const day = dayKey(reading.at)
    const held = byDay.get(day)
    if (!held || reading.at > held.at) byDay.set(day, reading)
  }
  return [...byDay.entries()]
    .map(([day, reading]) => ({
      id: reading.id,
      day,
      kg: reading.kg,
      source,
      updatedAt: reading.updatedAt,
      deletedAt: null,
    }))
    .sort((a, b) => a.day.localeCompare(b.day))
}
