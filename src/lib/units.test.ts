import { describe, expect, it } from 'vitest'
import {
  convertWeight,
  displayWeight,
  distanceFromM,
  distanceToM,
  formatDisplayWeight,
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

describe('convertWeight (aggregates — no plate snapping)', () => {
  it('converts a volume total exactly, not snapped to a plate grid', () => {
    // The reported bug: 12.5 × 10 = 125 kg total must display as 125, not get
    // rounded to a loadable 120/122.5 the way a single set weight would.
    expect(convertWeight(125, 'kg')).toBe(125)
  })

  it('does not snap a lb total onto the 2.5 lb increment', () => {
    // A summed total can legitimately land off the plate grid; weightFromKg
    // would snap it, convertWeight keeps it exact.
    const totalKg = weightToKg(122.5, 'lb') * 3 // 367.5 lb of total volume
    expect(Math.round(convertWeight(totalKg, 'lb'))).toBe(368)
    expect(convertWeight(50, 'kg')).toBe(50)
  })
})

describe('displayWeight (derived values — the e1RM long-decimal bug)', () => {
  it('rounds a raw e1RM to a whole number, never a trailing decimal tail', () => {
    // The reported bug: an e1RM of ~113.79 kg converted to lb is 250.833...,
    // which leaked to the UI. It must read as a whole number.
    const e1rmKg = 113.79
    expect(displayWeight(e1rmKg, 'lb')).toBe(251)
    expect(Number.isInteger(displayWeight(e1rmKg, 'lb'))).toBe(true)
  })

  it('does not plate-snap — 125 kg of volume stays 125, not 124/126', () => {
    expect(displayWeight(125, 'kg')).toBe(125)
  })

  it('formats with a thousands separator and unit', () => {
    expect(formatDisplayWeight(weightToKg(1240, 'lb'), 'lb')).toBe('1,240 lb')
  })

  it('omits the unit when asked', () => {
    expect(formatDisplayWeight(50, 'kg', { withUnit: false })).toBe('50')
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
