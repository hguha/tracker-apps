import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@tracker-engine/ui'
import { AccountScreen } from '../src/react/AccountScreen'
import type { Session } from '../src/types'

afterEach(cleanup)

const session: Session = {
  userId: 'u1',
  email: 'u1@example.com',
  displayName: 'Old Name',
  createdAt: 0,
  isVerified: true,
  isLocal: false,
}

describe('AccountScreen', () => {
  it('saves a renamed display name once when the field blurs on the way to Save', async () => {
    let finish: () => void = () => {}
    const updateDisplayName = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    render(
      createElement(
        ToastProvider,
        null,
        createElement(AccountScreen, {
          auth: {
            session,
            signOut: vi.fn(),
            updateDisplayName,
            updatePassword: vi.fn(),
            deleteAccount: vi.fn(),
          },
          onBack: () => {},
          unsyncedChanges: 0,
          whatIsErased: 'everything',
          nameHint: '',
          privacyUrl: 'https://example.com',
          onDeleted: async () => {},
        }),
      ),
    )

    const field = screen.getByLabelText('Display name')
    fireEvent.change(field, { target: { value: 'New Name' } })
    fireEvent.blur(field)
    fireEvent.click(screen.getByLabelText('Save name'))
    await act(async () => finish())

    expect(updateDisplayName).toHaveBeenCalledTimes(1)
  })
})
