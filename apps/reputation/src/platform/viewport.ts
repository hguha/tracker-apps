import { isNativePlatform } from '../lib/platform'

export type Shell = 'native' | 'installed' | 'browser'

// `@media (display-mode: standalone)` does not match in an installed iOS web app, so the
// shell can only be detected here, not in CSS.
export function detectShell(): Shell {
  if (isNativePlatform()) return 'native'
  const standalone = (navigator as { standalone?: boolean }).standalone === true
  return standalone || window.matchMedia('(display-mode: standalone)').matches
    ? 'installed'
    : 'browser'
}

export function safeAreaInsets(): { top: number; bottom: number } {
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)'
  document.body.appendChild(probe)
  const style = getComputedStyle(probe)
  const insets = {
    top: Math.round(parseFloat(style.paddingTop) || 0),
    bottom: Math.round(parseFloat(style.paddingBottom) || 0),
  }
  probe.remove()
  return insets
}

export function viewportShortfall(): number {
  const screenHeight = window.screen?.height ?? 0
  const viewport = window.visualViewport?.height ?? window.innerHeight
  return Math.max(0, Math.round(screenHeight - viewport))
}

const SHORTFALL_TOLERANCE = 24

/**
 * iOS pins a home-screen app's window geometry at install and never revisits it, so an
 * icon can outlive the HTML it was added from. A window short of the screen is normal on
 * its own (one starting below the status bar reports a top inset of 0); short *and*
 * reporting a top inset is contradictory, and leaves a strip outside the web view that no
 * CSS can paint. Only deleting and re-adding the icon fixes it.
 */
export function hasStaleWindow(): boolean {
  if (detectShell() !== 'installed') return false
  return viewportShortfall() >= SHORTFALL_TOLERANCE && safeAreaInsets().top > 0
}
