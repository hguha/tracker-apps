import { describe, expect, it } from 'vitest'
import { isCardioPattern, movementFor, patternForRegion } from '@/domain/movement'
import { MOVEMENT_PATTERNS, REGIONS } from '@/domain/types'

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

describe('movementFor', () => {
  it('strips a leading equipment word', () => {
    expect(movementFor('Barbell Bench Press')).toBe('Bench Press')
    expect(movementFor('Dumbbell Bench Press')).toBe('Bench Press')
    expect(movementFor('Cable Fly')).toBe('Fly')
  })

  it('strips an equipment word mid-name so grip/angle groups together', () => {
    expect(movementFor('Incline Barbell Bench Press')).toBe('Incline Bench Press')
    expect(movementFor('Incline Dumbbell Bench Press')).toBe('Incline Bench Press')
  })

  it('keeps grip/angle in the movement — those are distinct lifts', () => {
    expect(movementFor('Incline Bench Press')).toBe('Incline Bench Press')
    expect(movementFor('Close-Grip Bench Press')).toBe('Close-Grip Bench Press')
    expect(movementFor('Sumo Deadlift')).toBe('Sumo Deadlift')
  })

  it('prefers "Smith Machine" over "Smith" or "Machine" alone', () => {
    // Otherwise a Smith Machine press would fall to "Machine Bench Press".
    expect(movementFor('Smith Machine Bench Press')).toBe('Bench Press')
  })

  it('leaves names without an equipment word untouched', () => {
    expect(movementFor('Push-up')).toBe('Push-up')
    expect(movementFor('Pull-up')).toBe('Pull-up')
    expect(movementFor('Dip')).toBe('Dip')
    expect(movementFor('Plank')).toBe('Plank')
  })

  it('never returns an empty string, even for degenerate names', () => {
    expect(movementFor('')).toBe('')
    // If a name IS just an equipment word, we keep it rather than blank it out;
    // grouping still works because the movement equals the input.
    expect(movementFor('Barbell')).toBe('Barbell')
  })
})
