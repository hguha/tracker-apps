// Native status bar. Matches the bar's text/icons to the active color scheme so
// they stay legible on the theme surface. No-op on web (there is no OS bar).
import { isNativePlatform } from './detect'

export function applyStatusBarStyle(scheme: 'light' | 'dark'): void {
  if (!isNativePlatform()) return
  void (async () => {
    try {
      const { StatusBar, Style } = await import('@capacitor/status-bar')
      // Style.Dark = dark text for light backgrounds, and vice versa.
      await StatusBar.setStyle({ style: scheme === 'dark' ? Style.Dark : Style.Light })
    } catch {
      // Android throws if edge-to-edge isn't set up; safe to ignore.
    }
  })()
}
