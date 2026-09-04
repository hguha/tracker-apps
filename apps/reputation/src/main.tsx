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

// Marks the native shell for CSS, before the first paint. The safe-area rules key off
// this rather than `display-mode` alone: only native draws edge-to-edge and must pad
// its own insets, and a Capacitor WebView can match `display-mode: standalone` just
// like an installed web app (see styles/index.css).
if (isNativePlatform()) document.documentElement.dataset.shell = 'native'

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
