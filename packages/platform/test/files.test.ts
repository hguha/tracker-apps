import { describe, expect, it, vi } from 'vitest'

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' },
}))

const { pickBackupText } = await import('../src/files')

describe('pickBackupText', () => {
  it('reads the file the user chose, inside the native shell too', async () => {
    const file = new File(['{"version":1}'], 'backup.json', { type: 'application/json' })
    expect(await pickBackupText(file)).toBe('{"version":1}')
  })

  it('returns null when nothing was chosen', async () => {
    expect(await pickBackupText()).toBeNull()
  })
})
