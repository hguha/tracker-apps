import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/database'
import { seedIfNeeded } from '@/db/seed'
import { LOCAL_DEV_CODE, LocalAuthProvider, deriveName } from './localAuthProvider'
import { initialsOf, isSubmittableCode, isValidEmail } from './types'

beforeEach(async () => {
  localStorage.clear()
  await db.delete()
  await db.open()
  await seedIfNeeded()
})

describe('isValidEmail', () => {
  it('accepts ordinary addresses', () => {
    expect(isValidEmail('a@b.co')).toBe(true)
    expect(isValidEmail('harsh.guha+gym@example.com')).toBe(true)
  })

  it('rejects obvious non-addresses', () => {
    expect(isValidEmail('')).toBe(false)
    expect(isValidEmail('no-at-sign')).toBe(false)
    expect(isValidEmail('missing@tld')).toBe(false)
    expect(isValidEmail('two spaces@x.com')).toBe(false)
  })

  it('tolerates surrounding whitespace, since a paste often includes it', () => {
    expect(isValidEmail('  a@b.co  ')).toBe(true)
  })
})

describe('isSubmittableCode', () => {
  it('accepts a token longer than 6, which the old 6-only gate rejected', () => {
    // The bug: mailer_otp_length is a server setting (6–10) and this project is
    // configured for 8, but the screen required exactly 6 — so the submit button
    // never enabled and entering a valid code did nothing.
    expect(isSubmittableCode('12345678')).toBe(true)
    expect(isSubmittableCode('1234567890')).toBe(true)
  })

  it('accepts the 6-character local dev code', () => {
    expect(isSubmittableCode(LOCAL_DEV_CODE)).toBe(true)
  })

  it('accepts alphanumeric tokens — they are not guaranteed to be digits', () => {
    expect(isSubmittableCode('A1B2C3')).toBe(true)
    expect(isSubmittableCode('abc12345')).toBe(true)
  })

  it('rejects an obviously incomplete or oversized entry', () => {
    expect(isSubmittableCode('')).toBe(false)
    expect(isSubmittableCode('123')).toBe(false)
    expect(isSubmittableCode('1'.repeat(11))).toBe(false)
  })

  it('tolerates surrounding whitespace, since a paste often includes it', () => {
    expect(isSubmittableCode('  12345678  ')).toBe(true)
  })
})

describe('deriveName', () => {
  it('turns an email local part into a plausible name', () => {
    expect(deriveName('harsh.guha@example.com')).toBe('Harsh Guha')
    expect(deriveName('jane_doe@example.com')).toBe('Jane Doe')
    expect(deriveName('mike@example.com')).toBe('Mike')
  })

  it('strips digits rather than producing "User123"', () => {
    expect(deriveName('lifter99@example.com')).toBe('Lifter')
  })

  it('falls back when there is nothing usable', () => {
    expect(deriveName('123@example.com')).toBe('You')
  })
})

describe('initialsOf', () => {
  it('uses first and last initials', () => {
    expect(initialsOf('Harsh Guha')).toBe('HG')
    expect(initialsOf('Ada Byron Lovelace')).toBe('AL')
  })

  it('uses two letters for a single name', () => {
    expect(initialsOf('Prince')).toBe('PR')
  })

  it('degrades rather than crashing on empty input', () => {
    expect(initialsOf('')).toBe('?')
    expect(initialsOf('   ')).toBe('?')
  })
})

describe('LocalAuthProvider', () => {
  it('starts with no session', async () => {
    const auth = new LocalAuthProvider()
    expect(await auth.getSession()).toBeNull()
  })

  it('creates a session via continue-offline', async () => {
    const auth = new LocalAuthProvider()
    const result = await auth.continueOffline('Harsh')

    expect(result.kind).toBe('session')
    const session = await auth.getSession()
    expect(session).toMatchObject({ displayName: 'Harsh', isLocal: true })
  })

  it('persists the session across provider instances', async () => {
    const first = new LocalAuthProvider()
    await first.continueOffline('Harsh')

    // A reload constructs a new provider; the session must survive it.
    const second = new LocalAuthProvider()
    expect((await second.getSession())?.displayName).toBe('Harsh')
  })

  it('survives a corrupt stored session by signing the user out', async () => {
    localStorage.setItem('workout-tracker.session', '{not json')
    const auth = new LocalAuthProvider()
    // Better to land on the sign-in screen than to crash on boot.
    expect(await auth.getSession()).toBeNull()
  })

  describe('the email path', () => {
    it('reports a code was sent for a valid address', async () => {
      const auth = new LocalAuthProvider()
      const result = await auth.signInWithEmail('a@b.co')
      expect(result).toEqual({ kind: 'code-sent', email: 'a@b.co' })
    })

    it('rejects an invalid address before pretending to send', async () => {
      const auth = new LocalAuthProvider()
      const result = await auth.signInWithEmail('nope')
      expect(result.kind).toBe('error')
    })

    it('normalizes case, so a capitalized retype still verifies', async () => {
      const auth = new LocalAuthProvider()
      await auth.signInWithEmail('Harsh@Example.COM')
      const result = await auth.verifyCode('harsh@example.com', LOCAL_DEV_CODE)
      expect(result.kind).toBe('session')
    })

    it('rejects a wrong code', async () => {
      const auth = new LocalAuthProvider()
      await auth.signInWithEmail('a@b.co')
      const result = await auth.verifyCode('a@b.co', '123456')
      expect(result.kind).toBe('error')
    })

    it('rejects a code submitted for a different address', async () => {
      const auth = new LocalAuthProvider()
      await auth.signInWithEmail('a@b.co')
      const result = await auth.verifyCode('other@b.co', LOCAL_DEV_CODE)
      expect(result.kind).toBe('error')
    })

    it('marks an email session verified and an offline one not', async () => {
      const email = new LocalAuthProvider()
      await email.signInWithEmail('a@b.co')
      await email.verifyCode('a@b.co', LOCAL_DEV_CODE)
      expect((await email.getSession())?.isVerified).toBe(true)

      localStorage.clear()
      const offline = new LocalAuthProvider()
      await offline.continueOffline()
      expect((await offline.getSession())?.isVerified).toBe(false)
    })
  })

  it('keeps the same user id when signing back in, so data stays owned', async () => {
    const auth = new LocalAuthProvider()
    await auth.continueOffline('Harsh')
    const firstId = (await auth.getSession())!.userId

    await auth.signOut()
    await auth.continueOffline('Harsh')
    expect((await auth.getSession())!.userId).toBe(firstId)
  })

  it('notifies subscribers on sign in and sign out', async () => {
    const auth = new LocalAuthProvider()
    const seen: (string | null)[] = []
    const unsubscribe = auth.onSessionChange((s) => seen.push(s?.displayName ?? null))

    await auth.continueOffline('Harsh')
    await auth.signOut()
    unsubscribe()
    await auth.continueOffline('Ignored')

    // The post-unsubscribe change must not appear.
    expect(seen).toEqual(['Harsh', null])
  })

  it('renames both the session and the profile row', async () => {
    const auth = new LocalAuthProvider()
    await auth.continueOffline('Harsh')

    await auth.updateDisplayName('Harsh Guha')

    expect((await auth.getSession())?.displayName).toBe('Harsh Guha')
    expect((await db.profiles.get('local-user'))?.displayName).toBe('Harsh Guha')
  })

  it('ignores a blank rename rather than clearing the name', async () => {
    const auth = new LocalAuthProvider()
    await auth.continueOffline('Harsh')
    await auth.updateDisplayName('   ')
    expect((await auth.getSession())?.displayName).toBe('Harsh')
  })

  it('signing out leaves local data intact', async () => {
    const auth = new LocalAuthProvider()
    await auth.continueOffline('Harsh')
    const exerciseCount = await db.exercises.count()

    await auth.signOut()

    expect(await auth.getSession()).toBeNull()
    // Signing out is not a deletion — the data is still there to sign back into.
    expect(await db.exercises.count()).toBe(exerciseCount)
  })

  it('deleting the account wipes the local database', async () => {
    const auth = new LocalAuthProvider()
    await auth.continueOffline('Harsh')

    const workoutId = crypto.randomUUID()
    await db.workouts.add({
      id: workoutId,
      userId: 'local-user',
      startedAt: Date.now(),
      endedAt: null,
      title: '',
      notes: '',
      perceivedExertion: null,
      templateId: null,
      bodyweightKg: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: null,
      clientRev: 1,
    })

    await auth.deleteAccount()

    // Leaving rows behind would let the next account read this one's cached data,
    // which no server policy can prevent (§11.1.3).
    expect(await auth.getSession()).toBeNull()
    expect(await db.workouts.count()).toBe(0)
    expect(await db.exercises.count()).toBe(0)
  })
})
