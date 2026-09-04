import { isNativePlatform } from '../lib/platform'

/**
 * Read-only facts about the window we're running in, for the Display diagnostic in
 * Settings -> Data & sync. Nothing here changes the layout: the safe-area padding is
 * plain `env()` in styles/index.css and needs no help from JS.
 */

export type Shell = 'native' | 'installed' | 'browser'

/**
 * Note that `@media (display-mode: standalone)` does NOT match in an installed iOS web
 * app — verified on device — so CSS cannot detect this and any rule gated on that query
 * silently does nothing. `navigator.standalone` is iOS's own flag and reports the truth.
 */
export function detectShell(): Shell {
  if (isNativePlatform()) return 'native'
  const standalone = (navigator as { standalone?: boolean }).standalone === true
  return standalone || window.matchMedia('(display-mode: standalone)').matches
    ? 'installed'
    : 'browser'
}

/** Resolves env(safe-area-inset-*) the way the layout does, via a real element. */
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

/** How many pixels of the physical screen the window doesn't cover. */
export function viewportShortfall(): number {
  const screenHeight = window.screen?.height ?? 0
  const viewport = window.visualViewport?.height ?? window.innerHeight
  return Math.max(0, Math.round(screenHeight - viewport))
}

/** Bigger than rounding noise, smaller than any real safe-area inset. */
const SHORTFALL_TOLERANCE = 24

/**
 * Whether this home-screen app is running in a window left over from an older install.
 *
 * iOS fixes an installed app's window geometry when it is added and never revisits it, so
 * a home-screen app can keep a layout its current HTML would no longer ask for. The
 * signature is a window short of the screen that *also* reports a top inset: short means
 * the window doesn't reach the bottom of the screen, and a top inset means the app is
 * being asked to clear a status bar it therefore can't be sitting below. The two together
 * are contradictory, and produce a strip along the bottom that is outside the web view —
 * unpaintable by any stylesheet. Being merely short is normal and fine: that is just a
 * window that starts below the status bar, and it reports a top inset of 0.
 *
 * The only remedy is deleting the home-screen app and adding it again. See
 * docs/ios-safe-areas.md.
 */
export function hasStaleWindow(): boolean {
  if (detectShell() !== 'installed') return false
  return viewportShortfall() >= SHORTFALL_TOLERANCE && safeAreaInsets().top > 0
}
