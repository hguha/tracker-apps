// Rest-timer notification: the REPutation-specific wrapper over the generic
// local-notification scheduler in @tracker-engine/platform. Same API + behavior
// as before (fixed id, "Rest complete" copy).
import {
  cancelLocalNotification,
  scheduleLocalNotification,
} from '@tracker-engine/platform'

const REST_NOTIFICATION_ID = 1

export function scheduleRestDone(targetAtMs: number): void {
  scheduleLocalNotification({
    id: REST_NOTIFICATION_ID,
    title: 'Rest complete',
    body: 'Time for your next set.',
    at: targetAtMs,
  })
}

export function cancelRestDone(): void {
  cancelLocalNotification(REST_NOTIFICATION_ID)
}
