import { Component, type ReactNode } from 'react'

// A crash in one screen shouldn't blank the whole app. Catches render errors and
// offers a reload rather than a white screen.
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('[ledger] render error', error)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-lg font-semibold text-ink">Something went wrong</p>
          <p className="text-sm text-ink-muted">
            Your data is safe on this device. Reloading usually clears it.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 h-11 rounded-xl bg-accent px-5 font-semibold text-accent-contrast"
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
