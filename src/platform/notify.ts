// Rest-timer local notification. The timer is otherwise in-app only: if the
// phone locks or the app backgrounds mid-rest, nothing fires. On native we
// schedule a local notification for the moment rest is up (local — no APNs/FCM,
// no server). On web this is a no-op; the in-app countdown and audio cue stand.
import { isNativePlatform } from '@/lib/platform'

// Fixed id so a reschedule/cancel always targets the same pending notification.
const REST_NOTIFICATION_ID = 1

let permissionAsked = false

async function ensurePermission(): Promise<boolean> {
  const { LocalNotifications } = await import('@capacitor/local-notifications')
  let status = await LocalNotifications.checkPermissions()
  if (status.display === 'prompt' && !permissionAsked) {
    permissionAsked = true
    status = await LocalNotifications.requestPermissions()
  }
  return status.display === 'granted'
}

export function scheduleRestDone(targetAtMs: number): void {
  if (!isNativePlatform()) return
  void (async () => {
    try {
      if (!(await ensurePermission())) return
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      // Already elapsed (rare race) — don't schedule a past-dated alert.
      if (targetAtMs <= Date.now()) return
      await LocalNotifications.schedule({
        notifications: [
          {
            id: REST_NOTIFICATION_ID,
            title: 'Rest complete',
            body: 'Time for your next set.',
            schedule: { at: new Date(targetAtMs) },
          },
        ],
      })
    } catch {
      // A missing alert is a soft failure; the in-app timer still runs.
    }
  })()
}

export function cancelRestDone(): void {
  if (!isNativePlatform()) return
  void (async () => {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      await LocalNotifications.cancel({
        notifications: [{ id: REST_NOTIFICATION_ID }],
      })
    } catch {
      // ignore
    }
  })()
}
