import type { LengthUnit } from '@/domain/types'
import { lengthToCm, parseNumber } from '@/lib/units'

export function heightAnswerCm(
  typed: string,
  unit: LengthUnit,
  savedCm: number | null,
): number | null {
  const height = parseNumber(typed)
  return height !== null && height > 0 ? lengthToCm(height, unit) : savedCm
}
