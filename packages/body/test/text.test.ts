import { describe, expect, it } from 'vitest'
import { DAY_MS, WEEK_MS } from '@tracker-engine/core'
import { perWeek, timeUntil } from '../src/text'

const NOW = Date.parse('2026-10-04T12:00:00')

describe('timeUntil', () => {
  it('counts days, then weeks, then months', () => {
    expect(timeUntil(NOW + DAY_MS, NOW)).toBe('1 day')
    expect(timeUntil(NOW + 6 * DAY_MS, NOW)).toBe('6 days')
    expect(timeUntil(NOW + 4 * WEEK_MS, NOW)).toBe('4 wk')
    expect(timeUntil(NOW + 26 * WEEK_MS, NOW)).toBe('6 mo')
  })
})

describe('perWeek', () => {
  it('signs the rate and speaks the unit', () => {
    expect(perWeek(-0.5, 'kg')).toBe('-0.5 kg/wk')
    expect(perWeek(0.5, 'lb')).toBe('+1.1 lb/wk')
  })
})
