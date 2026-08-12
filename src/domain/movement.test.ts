import { describe, expect, it } from 'vitest'
import { isCardioPattern, patternForRegion } from './movement'
import { MOVEMENT_PATTERNS, REGIONS } from './types'

describe('patternForRegion', () => {
  it('maps pushing regions to push', () => {
    expect(patternForRegion('chest')).toBe('push')
    expect(patternForRegion('shoulders')).toBe('push')
    expect(patternForRegion('triceps')).toBe('push')
  })

  it('maps pulling regions to pull', () => {
    expect(patternForRegion('back')).toBe('pull')
    expect(patternForRegion('biceps')).toBe('pull')
  })

  it('maps cardio to cardio, which switches the whole logging UI (§6.4)', () => {
    expect(patternForRegion('cardio')).toBe('cardio')
    expect(isCardioPattern(patternForRegion('cardio'))).toBe(true)
  })

  it('maps everything else to other', () => {
    expect(patternForRegion('legs')).toBe('other')
    expect(patternForRegion('core')).toBe('other')
  })

  it('is total over every region, and only ever returns a live pattern', () => {
    // The switch has no default, so a new Region is a compile error rather than a
    // silent fallthrough. This guards the runtime side of the same contract: a
    // stale value here would break cardio detection and the "Push" session title
    // without failing anywhere obvious.
    for (const region of REGIONS) {
      expect(MOVEMENT_PATTERNS).toContain(patternForRegion(region))
    }
  })

  it('never reports non-cardio work as cardio', () => {
    for (const region of REGIONS.filter((r) => r !== 'cardio')) {
      expect(isCardioPattern(patternForRegion(region))).toBe(false)
    }
  })
})
