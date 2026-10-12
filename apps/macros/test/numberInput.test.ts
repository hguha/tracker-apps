import { describe, expect, it } from 'vitest'
import { readNumber } from '@tracker-engine/ui'

describe('readNumber', () => {
  it('reads a typed amount, including a half-typed decimal', () => {
    expect(readNumber('1.5', true)).toBe(1.5)
    expect(readNumber('1.', true)).toBe(1)
  })

  it('ignores blanks, negatives and a zero where zero is not allowed', () => {
    expect(readNumber('', true)).toBeNull()
    expect(readNumber('  ', true)).toBeNull()
    expect(readNumber('-2', true)).toBeNull()
    expect(readNumber('0', false)).toBeNull()
    expect(readNumber('0', true)).toBe(0)
  })
})
