import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { applyDefaultAppearance } from './lib/theme'
import './styles/index.css'

// Theme tokens must exist before the first paint — the sign-in screen is drawn
// before any profile has loaded, and unset variables render as transparent.
applyDefaultAppearance()

const container = document.getElementById('root')
if (!container) throw new Error('Root element missing from index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
