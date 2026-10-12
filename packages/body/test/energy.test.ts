import { describe, expect, it } from 'vitest'
import { restingKcal } from '../src/energy'

describe('restingKcal', () => {
  it('is the Mifflin–St Jeor estimate', () => {
    expect(restingKcal({ kg: 80, heightCm: 180, age: 30, sex: 'male' })).toBe(1780)
    expect(restingKcal({ kg: 80, heightCm: 180, age: 30, sex: 'female' })).toBe(1614)
  })
})
