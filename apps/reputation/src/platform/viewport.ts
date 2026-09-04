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

/**
 * How many pixels of the physical screen the window doesn't cover — the number that
 * exposed the `black-translucent` bug, where an installed app got a window 62px shorter
 * than the screen and still drew from y=0, leaving a strip outside the web view.
 *
 * Only meaningful for the installed shell: a browser tab is legitimately shorter than
 * the screen (that's the chrome), and the native shell sizes its own window.
 */
export function viewportShortfall(): number {
  const screenHeight = window.screen?.height ?? 0
  const viewport = window.visualViewport?.height ?? window.innerHeight
  return Math.max(0, Math.round(screenHeight - viewport))
}
