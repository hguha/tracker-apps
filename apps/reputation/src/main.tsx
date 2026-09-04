import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { ErrorBoundary } from './app/ErrorBoundary'
import { installGlobalErrorHandlers } from './backend/errorReporter'
import { registerServiceWorker } from './lib/serviceWorker'
import { applyDefaultAppearance } from './lib/theme'
import { initDeepLinks } from './platform/deepLinks'
import { initNativeShell } from './platform/native'
import { publishShell } from './platform/viewport'
import './styles/index.css'

// Publishes `data-shell` / `data-viewport` on <html> for the safe-area rules to key
// off. Must run before the first paint, so it stays at the top of this file.
publishShell()

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
