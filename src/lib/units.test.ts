import { describe, expect, it } from 'vitest'
import {
  distanceFromM,
  distanceToM,
  formatDuration,
  formatPace,
  formatWeight,
  lengthFromCm,
  lengthToCm,
  weightFromKg,
  weightToKg,
} from './units'

describe('weight round-trip', () => {
  // The requirement from §4.12: what the user typed is what the user sees.
  it('returns the exact value a lb user entered', () => {
    for (let lb = 2.5; lb <= 600; lb += 2.5) {
      const stored = weightToKg(lb, 'lb')
      expect(weightFromKg(stored, 'lb')).toBe(lb)
    }
  })

  it('returns the exact value a kg user entered', () => {
    for (let kg = 1.25; kg <= 300; kg += 1.25) {
      const stored = weightToKg(kg, 'kg')
      expect(weightFromKg(stored, 'kg')).toBe(kg)
    }
  })

  it('snaps a cross-unit value to a loadable increment', () => {
    // 100 kg is 220.46 lb, which nobody can load. Nearest 2.5 lb is 220.
    expect(weightFromKg(100, 'lb')).toBe(220)
  })

  it('honors a micro-plate increment when given one', () => {
    expect(weightFromKg(100, 'lb', 0.5)).toBe(220.5)
  })
})

describe('formatWeight', () => {
  it('drops a pointless trailing zero', () => {
    expect(formatWeight(weightToKg(135, 'lb'), 'lb')).toBe('135 lb')
  })

  it('renders an em dash for a missing value rather than 0', () => {
    expect(formatWeight(null, 'kg')).toBe('—')
  })
})

describe('distance', () => {
  it('round-trips miles', () => {
    const stored = distanceToM(3.1, 'mi')
    expect(distanceFromM(stored, 'mi')).toBeCloseTo(3.1, 3)
  })

  it('round-trips kilometers exactly', () => {
    expect(distanceFromM(distanceToM(5, 'km'), 'km')).toBe(5)
  })
})

describe('length', () => {
  it('round-trips inches', () => {
    expect(lengthFromCm(lengthToCm(15.5, 'in'), 'in')).toBeCloseTo(15.5, 2)
  })
})

describe('formatDuration', () => {
  it('formats under an hour as m:ss', () => {
    expect(formatDuration(90)).toBe('1:30')
  })

  it('pads seconds', () => {
    expect(formatDuration(65)).toBe('1:05')
  })

  it('formats over an hour as h:mm:ss', () => {
    expect(formatDuration(3725)).toBe('1:02:05')
  })

  it('never renders a negative clock', () => {
    expect(formatDuration(-5)).toBe('0:00')
  })
})

describe('formatPace', () => {
  it('computes per-mile pace', () => {
    // 3 miles in 27 minutes is a 9:00 mile.
    expect(formatPace(27 * 60, distanceToM(3, 'mi'), 'mi')).toBe('9:00 / mi')
  })

  it('returns null rather than dividing by zero', () => {
    expect(formatPace(600, 0, 'km')).toBeNull()
    expect(formatPace(null, 5000, 'km')).toBeNull()
  })
})
