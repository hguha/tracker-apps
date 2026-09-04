import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { ErrorBoundary } from './app/ErrorBoundary'
import { installGlobalErrorHandlers } from './backend/errorReporter'
import { registerServiceWorker } from './lib/serviceWorker'
import { applyDefaultAppearance } from './lib/theme'
import { initDeepLinks } from './platform/deepLinks'
import { isNativePlatform } from './lib/platform'
import { initNativeShell } from './platform/native'
import './styles/index.css'

/**
 * Which shell we're in, decided here and published to CSS as `data-shell`, before the
 * first paint.
 *
 * The safe-area rules key off this attribute instead of `@media (display-mode: ...)`
 * because that media query does NOT match in an installed iOS web app — verified on
 * device — so every rule gated on it silently did nothing. `navigator.standalone` is
 * iOS's own flag for a home-screen app and is what actually reports the truth.
 */
document.documentElement.dataset.shell = isNativePlatform()
  ? 'native'
  : (navigator as { standalone?: boolean }).standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches
    ? 'installed'
    : 'browser'

// Theme tokens must exist before the first paint — the sign-in screen is drawn
// before any profile has loaded, and unset variables render as transparent.
applyDefaultAppearance()
installGlobalErrorHandlers()
initNativeShell()
initDeepLinks()
void registerServiceWorker()

const container = document.getElementById('root')
if (!container) throw new Error('Root element missing from index.html')

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
