import { isNativePlatform } from '../lib/platform'

/**
 * Which shell we're in, and how much of the screen it actually gets. Both are published
 * to CSS as attributes on <html> before the first paint, because the safe-area rules
 * cannot be written as media queries.
 *
 * `data-shell` exists because `@media (display-mode: standalone)` does NOT match in an
 * installed iOS web app — verified on device — so every rule gated on it silently did
 * nothing. `navigator.standalone` is iOS's own flag for a home-screen app and reports
 * the truth.
 *
 * `data-viewport` marks the broken installed geometry documented in
 * docs/ios-safe-areas.md: a window that is shorter than the screen while still drawing
 * from y=0, so a strip along the bottom falls outside the web view. No CSS can paint
 * there, but the layout can at least stop reserving space for a home indicator that
 * isn't inside our window.
 */

type Shell = 'native' | 'installed' | 'browser'

function detectShell(): Shell {
  if (isNativePlatform()) return 'native'
  const standalone = (navigator as { standalone?: boolean }).standalone === true
  return standalone || window.matchMedia('(display-mode: standalone)').matches
    ? 'installed'
    : 'browser'
}

/**
 * How many pixels of the physical screen the window doesn't cover.
 *
 * Only meaningful for the installed shell: a browser tab is legitimately shorter than
 * the screen (that's the chrome), and the native shell sizes its own window.
 */
export function viewportShortfall(): number {
  const screenHeight = window.screen?.height ?? 0
  const viewport = window.visualViewport?.height ?? window.innerHeight
  return Math.max(0, Math.round(screenHeight - viewport))
}

/** Bigger than rounding noise, smaller than any real safe-area inset. */
const SHORTFALL_TOLERANCE = 24

function publishGeometry(shell: Shell): void {
  if (shell !== 'installed') return
  document.documentElement.dataset.viewport =
    viewportShortfall() >= SHORTFALL_TOLERANCE ? 'short' : 'full'
}

export function publishShell(): void {
  const shell = detectShell()
  document.documentElement.dataset.shell = shell
  publishGeometry(shell)
  // Rotating the device, and iOS resizing the window on its own, both change the
  // shortfall — so this is not a one-shot measurement.
  const recheck = () => publishGeometry(shell)
  window.visualViewport?.addEventListener('resize', recheck)
  window.addEventListener('orientationchange', recheck)
}
