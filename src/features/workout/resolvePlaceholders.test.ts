import { describe, expect, it } from 'vitest'
import { resolvePlaceholders, type SetValues } from './resolvePlaceholders'

function set(id: string, v: Partial<SetValues> = {}): SetValues & { id: string } {
  return { id, weightKg: null, reps: null, durationSeconds: null, distanceM: null, ...v }
}

const EMPTY = { weightKg: null, reps: null, durationSeconds: null, distanceM: null }

describe('resolvePlaceholders', () => {
  it('carries forward what set 1 logged to set 2+, with no history (the reported bug)', () => {
    // A brand-new exercise: no overrides, no previous session. The user fills
    // set 1; sets 2 and 3 should now suggest those numbers.
    const sets = [set('a', { weightKg: 60, reps: 10 }), set('b'), set('c')]
    const resolved = resolvePlaceholders(sets, {}, [])
    // Set 1 itself has no placeholder (nothing precedes it, no history).
    expect(resolved[0]).toBeUndefined()
    expect(resolved[1]).toMatchObject({ weightKg: 60, reps: 10 })
    expect(resolved[2]).toMatchObject({ weightKg: 60, reps: 10 })
  })

  it('lets a later logged set update the carry for rows after it', () => {
    const sets = [
      set('a', { weightKg: 60, reps: 10 }),
      set('b', { weightKg: 65, reps: 8 }),
      set('c'),
    ]
    const resolved = resolvePlaceholders(sets, {}, [])
    // Set 3 follows set 2, so it suggests set 2's numbers, not set 1's.
    expect(resolved[2]).toMatchObject({ weightKg: 65, reps: 8 })
  })

  it('prefers last session by index over carry-forward', () => {
    const sets = [set('a'), set('b')]
    const previous = [
      { ...EMPTY, weightKg: 100, reps: 5 },
      { ...EMPTY, weightKg: 100, reps: 5 },
    ]
    const resolved = resolvePlaceholders(sets, {}, previous)
    expect(resolved[0]).toMatchObject({ weightKg: 100, reps: 5 })
    expect(resolved[1]).toMatchObject({ weightKg: 100, reps: 5 })
  })

  it('prefers an explicit override above history and carry', () => {
    const sets = [set('a')]
    const overrides = { a: { ...EMPTY, weightKg: 80, reps: 3 } }
    const previous = [{ ...EMPTY, weightKg: 100, reps: 5 }]
    const resolved = resolvePlaceholders(sets, overrides, previous)
    expect(resolved[0]).toMatchObject({ weightKg: 80, reps: 3 })
  })

  it('falls back to last-session index when this row is past the logged carry', () => {
    // History has 3 sets; this session has 3 rows and none are filled yet.
    const sets = [set('a'), set('b'), set('c')]
    const previous = [
      { ...EMPTY, weightKg: 50, reps: 12 },
      { ...EMPTY, weightKg: 55, reps: 10 },
      { ...EMPTY, weightKg: 60, reps: 8 },
    ]
    const resolved = resolvePlaceholders(sets, {}, previous)
    expect(resolved[2]).toMatchObject({ weightKg: 60, reps: 8 })
  })

  it('leaves the very first row blank when nothing is known', () => {
    expect(resolvePlaceholders([set('a')], {}, [])[0]).toBeUndefined()
  })
})
