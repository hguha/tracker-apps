import { describe, expect, it } from 'vitest'
import { groupBy } from '../src/collections'

describe('groupBy', () => {
  it('keeps first-seen key order and item order within a group', () => {
    const groups = groupBy(['b1', 'a1', 'b2'], (value) => value[0])
    expect([...groups]).toEqual([
      ['b', ['b1', 'b2']],
      ['a', ['a1']],
    ])
  })
})
