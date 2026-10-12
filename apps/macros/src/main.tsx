import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from '@tracker-engine/ui'
import { installAuthDeepLinks } from '@tracker-engine/auth'
import { getSupabase } from './backend/supabaseClient'
import { App } from './app/App'
import { applyDefaultAppearance } from './lib/theme'
import { clearLocalData } from './data/repository'
import { registerServiceWorker } from './platform/serviceWorker'
import { installGlobalErrorHandlers, reportError } from './backend/errorReporter'
import './styles/index.css'

// Theme tokens must exist before first paint: the sign-in screen renders before any profile
// loads, and unset CSS variables paint as transparent.
applyDefaultAppearance()
void registerServiceWorker()
installGlobalErrorHandlers()
installAuthDeepLinks(getSupabase)

const container = document.getElementById('root')
if (!container) throw new Error('Root element missing from index.html')

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary
      onClearLocalData={clearLocalData}
      onError={(error) => void reportError('error-boundary', error)}
    >
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
