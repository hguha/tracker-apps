// Local notification scheduling (no server / APNs / FCM). The app uses it for the
// rest timer: if the phone locks or backgrounds mid-rest, this fires. No-op on web.
import { isNativePlatform } from './detect'

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

/** Schedule a one-shot local notification with a fixed id (so reschedule/cancel target it). */
export function scheduleLocalNotification(opts: {
  id: number
  title: string
  body: string
  at: number
}): void {
  if (!isNativePlatform()) return
  void (async () => {
    try {
      if (!(await ensurePermission())) return
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      if (opts.at <= Date.now()) return // already elapsed — don't schedule a past alert
      await LocalNotifications.schedule({
        notifications: [
          { id: opts.id, title: opts.title, body: opts.body, schedule: { at: new Date(opts.at) } },
        ],
      })
    } catch {
      // A missing alert is a soft failure; the in-app timer still runs.
    }
  })()
}

export function cancelLocalNotification(id: number): void {
  if (!isNativePlatform()) return
  void (async () => {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      await LocalNotifications.cancel({ notifications: [{ id }] })
    } catch {
      // ignore
    }
  })()
}
