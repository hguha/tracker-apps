// The native shell draws edge-to-edge (capacitor.config.ts sets contentInset:
// 'never'), so it needs `viewport-fit=cover` and handles the safe areas itself with
// env(safe-area-inset-*) — which is reliable inside a Capacitor WebView.
//
// The installed PWA deliberately does NOT get it: iOS reports those insets
// inconsistently for a home-screen web app, so letting iOS inset the web view is the
// only way to be sure content isn't left under the status bar. index.html therefore
// ships without `cover`, and this adds it back for native only.

import { isNativePlatform } from '@tracker-engine/platform'

export function applyNativeViewport(): void {
  if (!isNativePlatform()) return
  const meta = document.querySelector('meta[name="viewport"]')
  if (!meta) return
  const content = meta.getAttribute('content') ?? ''
  if (content.includes('viewport-fit')) return
  meta.setAttribute('content', `${content}, viewport-fit=cover`)
}
