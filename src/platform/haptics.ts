// Haptics. `navigator.vibrate` does nothing on iOS (WKWebView never supported
// it), so on native we route through Capacitor Haptics; on web we keep the
// existing vibrate call, which works on Android Chrome and no-ops elsewhere.
import { isNativePlatform } from '@/lib/platform'

function webVibrate(pattern: number | number[]): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(pattern)
  }
}

// A single buzz's length maps to a Capacitor impact style; a pattern (array) is
// a web-only affordance, so on native we approximate it with one medium impact.
export function haptic(pattern: number | number[]): void {
  if (!isNativePlatform()) {
    webVibrate(pattern)
    return
  }
  void (async () => {
    try {
      const { Haptics, ImpactStyle } = await import('@capacitor/haptics')
      const ms = Array.isArray(pattern) ? 30 : pattern
      const style =
        ms <= 12 ? ImpactStyle.Light : ms <= 30 ? ImpactStyle.Medium : ImpactStyle.Heavy
      await Haptics.impact({ style })
    } catch {
      // Plugin missing or call rejected — a buzz is never worth surfacing.
    }
  })()
}

// A distinct success cue for the PR moment: the OS success pattern on native,
// a short double-buzz on web.
export function hapticSuccess(): void {
  if (!isNativePlatform()) {
    webVibrate([12, 40, 12])
    return
  }
  void (async () => {
    try {
      const { Haptics, NotificationType } = await import('@capacitor/haptics')
      await Haptics.notification({ type: NotificationType.Success })
    } catch {
      // ignore
    }
  })()
}
