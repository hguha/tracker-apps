import { describe, expect, it } from 'vitest'
import {
  bodyWeightFromKg,
  convertWeight,
  formatWeight,
  lengthFromCm,
  lengthToCm,
  parseNumber,
  unitsFor,
  weightFromKg,
  weightToKg,
} from '../src/units'

describe('unitsFor', () => {
  it('maps one metric/imperial flag onto the three units', () => {
    expect(unitsFor('metric')).toEqual({ weight: 'kg', length: 'cm', distance: 'km' })
    expect(unitsFor('imperial')).toEqual({ weight: 'lb', length: 'in', distance: 'mi' })
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
