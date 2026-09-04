import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  onError?: (error: Error, info: ErrorInfo) => void
  /** Offered as a second recovery when the app can wipe its local copy and re-sync. */
  onClearLocalData?: () => Promise<void>
}

interface State {
  error: Error | null
}

/** A render error in one screen would otherwise blank the whole app with the reason only
 *  in the console. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Render error caught by ErrorBoundary:', error, info)
    this.props.onError?.(error, info)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    const clear = this.props.onClearLocalData

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
          {clear && (
            <button
              onClick={() => {
                const ok = window.confirm(
                  'Clear this device’s local data and reload? On a synced account it re-downloads from the server.',
                )
                if (ok) void clear().then(() => window.location.reload())
              }}
              className="h-11 rounded-xl px-5 text-[14px] font-semibold text-ink-secondary active:opacity-60"
            >
              Clear local data and reload
            </button>
          )}
        </div>
      </div>
    )
  }
}
