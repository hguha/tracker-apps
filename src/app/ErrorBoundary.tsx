/**
 * Catches render errors so a single bad row can't black-screen the whole app.
 *
 * A crash used to leave a blank page with the reason only in the console. This
 * shows what happened and offers the two recoveries that actually help: reload,
 * or clear the local data that's most often the culprit (a malformed synced row).
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { clearLocalData } from '@/data/repository'
import { reportError } from '@/lib/errorReporter'

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // §11.4: first-party log to Supabase (no third-party SDK).
    console.error('Render error caught by ErrorBoundary:', error, info)
    void reportError('error-boundary', error)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
        <div>
          <h1 className="text-[20px] font-bold tracking-tight">Something broke</h1>
          <p className="mt-2 text-[14px] text-ink-secondary">
            The app hit an error while rendering. Your data is still on this device.
          </p>
          <p className="mt-2 break-words text-[12px] text-ink-muted">{error.message}</p>
        </div>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => window.location.reload()}
            className="h-11 rounded-xl bg-accent px-5 text-[15px] font-semibold text-accent-contrast active:brightness-90"
          >
            Reload
          </button>
          <button
            onClick={() => {
              const ok = window.confirm(
                'Clear this device’s local data and reload? On a synced account it re-downloads from the server.',
              )
              if (ok) void clearLocalData().then(() => window.location.reload())
            }}
            className="h-11 rounded-xl px-5 text-[14px] font-semibold text-ink-secondary active:opacity-60"
          >
            Clear local data and reload
          </button>
        </div>
      </div>
    )
  }
}
