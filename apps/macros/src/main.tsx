import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from '@tracker-engine/ui'
import { App } from './app/App'
import { applyDefaultAppearance } from './lib/theme'
import { clearLocalData } from './data/repository'
import { registerServiceWorker } from './platform/serviceWorker'
import './styles/index.css'

// Theme tokens must exist before first paint: the sign-in screen renders before any profile
// loads, and unset CSS variables paint as transparent.
applyDefaultAppearance()
void registerServiceWorker()

const container = document.getElementById('root')
if (!container) throw new Error('Root element missing from index.html')

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary onClearLocalData={clearLocalData}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
