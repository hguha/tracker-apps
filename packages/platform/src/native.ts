// Native-shell boot: hide the splash once the web app has mounted, and add the
// body class that lets CSS opt into native-only tweaks. No-op on web.
import { isNativePlatform } from './detect'

export function initNativeShell(): void {
  if (!isNativePlatform()) return
  document.documentElement.dataset.native = 'true'
  void (async () => {
    try {
      const { SplashScreen } = await import('@capacitor/splash-screen')
      await SplashScreen.hide()
    } catch {
      // No splash plugin in this build — nothing to hide.
    }
  })()
}
