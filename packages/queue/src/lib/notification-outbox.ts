import { type Database, notificationOutbox, and, eq, sql } from '@repo/db'
import { reportPRReviewToMeter } from './stripe-meter.js'
import { sendSlackReviewNotification, type SlackReviewNotificationPayload } from './slack.js'

type MeterPayload = { customerId: string; reviewKey: string; timestamp: number }
type SlackPayload = { webhookUrl: string; notification: SlackReviewNotificationPayload }

/** Lease each delivery so concurrent scheduled and immediate workers cannot send it together. */
export async function drainNotificationOutbox(db: Database, reviewId?: string, limit = 50) {
  let delivered = 0
  for (let index = 0; index < limit; index++) {
    const row = await db.transaction(async (tx) => {
      const [candidate] = await tx
        .select()
        .from(notificationOutbox)
        .where(
          and(
            eq(notificationOutbox.status, 'pending'),
            sql`${notificationOutbox.nextAttemptAt} <= now()`,
            sql`(${notificationOutbox.lockedUntil} IS NULL OR ${notificationOutbox.lockedUntil} < now())`,
            reviewId ? eq(notificationOutbox.reviewId, reviewId) : undefined,
          ),
        )
        .orderBy(notificationOutbox.createdAt)
        .limit(1)
        .for('update', { skipLocked: true })
      if (!candidate) return null
      await tx
        .update(notificationOutbox)
        .set({
          attempts: candidate.attempts + 1,
          lockedUntil: new Date(Date.now() + 5 * 60_000),
        })
        .where(eq(notificationOutbox.id, candidate.id))
      return candidate
    })
    if (!row) break
    try {
      if (row.kind === 'stripe') {
        const payload = row.payload as MeterPayload
        await reportPRReviewToMeter(payload.customerId, payload.reviewKey, payload.timestamp)
      } else {
        const payload = row.payload as SlackPayload
        await sendSlackReviewNotification(payload.notification, payload.webhookUrl)
      }
      await db
        .update(notificationOutbox)
        .set({
          status: 'delivered',
          deliveredAt: new Date(),
          lockedUntil: null,
          lastError: null,
        })
        .where(eq(notificationOutbox.id, row.id))
      delivered++
    } catch {
      const attempts = row.attempts + 1
      await db
        .update(notificationOutbox)
        .set({
          status: attempts >= 10 ? 'failed' : 'pending',
          lockedUntil: null,
          nextAttemptAt: new Date(Date.now() + Math.min(3600, 30 * 2 ** attempts) * 1000),
          // Error messages from HTTP clients can contain webhook secrets.
          lastError: `${row.kind} delivery failed (attempt ${attempts})`,
        })
        .where(eq(notificationOutbox.id, row.id))
      console.error(`Notification ${row.id} delivery failed; attempt ${attempts}`)
    }
  }
  return { delivered }
}
