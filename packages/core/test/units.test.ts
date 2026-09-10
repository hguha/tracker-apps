import { describe, expect, it } from 'vitest'
import {
  bodyWeightFromKg,
  convertWeight,
  formatWeight,
  lengthFromCm,
  lengthToCm,
  parseNumber,
  formatVolume,
  unitsFor,
  volumeFromMl,
  volumeToMl,
  weightFromKg,
  weightToKg,
} from '../src/units'

describe('unitsFor', () => {
  it('maps one metric/imperial flag onto every unit', () => {
    expect(unitsFor('metric')).toEqual({
      weight: 'kg',
      length: 'cm',
      distance: 'km',
      volume: 'ml',
    })
    expect(unitsFor('imperial')).toEqual({
      weight: 'lb',
      length: 'in',
      distance: 'mi',
      volume: 'floz',
    })
  })
})

describe('volume', () => {
  it('stores millilitres and converts only for display, like weight does', () => {
    expect(volumeToMl(8, 'floz')).toBeCloseTo(236.6, 1)
    expect(volumeToMl(250, 'ml')).toBe(250)
    expect(volumeFromMl(250, 'floz')).toBeCloseTo(8.5, 1)
  })

  it('reads as a person would say it', () => {
    expect(formatVolume(250, 'ml')).toBe('250 ml')
    // One decimal past a litre: water is counted in glasses, so "1.75 L" claims precision it hasn't
    // got — and the second decimal is the kind of detail that makes a number look computed.
    expect(formatVolume(1750, 'ml')).toBe('1.8 L')
    expect(formatVolume(2000, 'ml')).toBe('2.0 L')
    expect(formatVolume(250, 'floz')).toBe('8 fl oz')
  })
})

describe('weight', () => {
  it('is exact in kg, which is what gets stored', () => {
    expect(weightToKg(100, 'kg')).toBe(100)
    expect(weightFromKg(100, 'kg')).toBe(100)
  })

  it('snaps a loaded weight to a real plate increment, and accepts the drift for it', () => {
    // 80 kg is 176.3698 lb, and a bar is loaded in half-pounds at best. Showing 176.5 is worth
    // 0.06 kg of round-trip error; showing 176.3698 to someone loading plates is not.
    expect(weightFromKg(80, 'lb')).toBe(176.5)
    expect(weightToKg(176.5, 'lb')).toBeCloseTo(80.06, 2)
  })

  it('round-trips a bodyweight tightly, because it is read not loaded', () => {
    // A tenth of a pound is 0.045 kg, so a tenth of a kg is the best a round trip can promise.
    expect(weightToKg(bodyWeightFromKg(80, 'lb'), 'lb')).toBeCloseTo(80, 1)
  })

  it('keeps a tenth for bodyweight, because that is what a scale reads', () => {
    expect(bodyWeightFromKg(80, 'lb')).toBe(176.4)
    expect(bodyWeightFromKg(80.04, 'kg')).toBe(80)
  })

  it('leaves an aggregate unrounded, so a total does not snap to a plate', () => {
    expect(convertWeight(80, 'lb')).toBeCloseTo(176.3698, 3)
  })

  it('formats null as a dash rather than zero', () => {
    expect(formatWeight(null, 'kg')).toBe('—')
    expect(formatWeight(80, 'kg')).toBe('80 kg')
    expect(formatWeight(80, 'kg', { withUnit: false })).toBe('80')
  })
})

describe('length', () => {
  it('round-trips a height', () => {
    expect(lengthToCm(lengthFromCm(178, 'in'), 'in')).toBeCloseTo(178, 1)
    expect(lengthFromCm(178, 'cm')).toBe(178)
  })
})

describe('parseNumber', () => {
  it('rejects anything that would store as NaN', () => {
    // A stored NaN reads as `!== null`, so it counts as a value and poisons every sum after it.
    expect(parseNumber('abc')).toBeNull()
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('  ')).toBeNull()
    expect(parseNumber('80.5')).toBe(80.5)
  })
})
