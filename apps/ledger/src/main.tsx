import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { ErrorBoundary } from './app/ErrorBoundary'
import { applyDefaultAppearance } from './lib/theme'
import './styles/index.css'

// Theme tokens must exist before first paint — the sign-in screen renders before
// any profile loads, and unset CSS variables paint as transparent.
applyDefaultAppearance()

const container = document.getElementById('root')
if (!container) throw new Error('Root element missing from index.html')

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
