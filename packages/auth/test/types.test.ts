import { describe, expect, it } from 'vitest'
import {
  initialsOf,
  isSubmittableCode,
  isValidEmail,
  isValidPassword,
  PASSWORD_MIN_LENGTH,
  passwordProblem,
} from '../src/types'

describe('auth helpers', () => {
  it('accepts plausible emails, rejects obvious non-emails', () => {
    expect(isValidEmail('a@b.co')).toBe(true)
    expect(isValidEmail('  name@example.com ')).toBe(true)
    expect(isValidEmail('nope')).toBe(false)
    expect(isValidEmail('a@b')).toBe(false)
  })

  it('accepts codes within the 6–10 length window', () => {
    expect(isSubmittableCode('123456')).toBe(true)
    expect(isSubmittableCode('1234567890')).toBe(true)
    expect(isSubmittableCode('12345')).toBe(false)
    expect(isSubmittableCode('12345678901')).toBe(false)
  })

  it('states why a password is unacceptable, and nothing when it is fine', () => {
    expect(passwordProblem('x'.repeat(PASSWORD_MIN_LENGTH))).toBeNull()
    expect(passwordProblem('x'.repeat(PASSWORD_MIN_LENGTH - 1))).toContain(
      String(PASSWORD_MIN_LENGTH),
    )
    // Whitespace is a legitimate character in a passphrase — never trimmed away.
    expect(passwordProblem('   a b   ')).toBeNull()
  })

  it('isValidPassword agrees with passwordProblem', () => {
    expect(isValidPassword('longenough')).toBe(true)
    expect(isValidPassword('short')).toBe(false)
  })

  it('derives initials from a display name', () => {
    expect(initialsOf('Hirsh Guha')).toBe('HG')
    expect(initialsOf('cher')).toBe('CH')
    expect(initialsOf('   ')).toBe('?')
  })
})
