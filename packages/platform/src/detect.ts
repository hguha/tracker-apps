// The one place code asks "am I inside the native shell?". Capacitor injects a
// global bridge in the WebView; on the plain web deploy there is none, so this is
// false and every wrapper falls back to its web behavior.
import { Capacitor } from '@capacitor/core'

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform()
}

export function platform(): 'ios' | 'android' | 'web' {
  return Capacitor.getPlatform() as 'ios' | 'android' | 'web'
}
