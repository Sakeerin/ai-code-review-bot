import { type Database } from './client'
import { reviewDispatchOutbox } from './schema'
import { and, eq, isNull, lte, or } from 'drizzle-orm'

export interface ReviewJob {
  taskId: string
  payload: Record<string, unknown>
  options: { concurrencyKey: string; idempotencyKey: string }
}

export async function dispatchReviewJobs(
  db: Database,
  send: (job: ReviewJob) => Promise<unknown>,
  id?: string,
) {
  const now = new Date()
  const lease = new Date(now.getTime() + 120_000)
  const rows = await db.transaction(async (tx) => {
    const pending = await tx
      .select()
      .from(reviewDispatchOutbox)
      .where(
        and(
          isNull(reviewDispatchOutbox.dispatchedAt),
          lte(reviewDispatchOutbox.nextAttemptAt, now),
          or(isNull(reviewDispatchOutbox.lockedUntil), lte(reviewDispatchOutbox.lockedUntil, now)),
          id ? eq(reviewDispatchOutbox.id, id) : undefined,
        ),
      )
      .orderBy(reviewDispatchOutbox.nextAttemptAt)
      .limit(25)
      .for('update', { skipLocked: true })
    for (const row of pending)
      await tx
        .update(reviewDispatchOutbox)
        .set({ lockedUntil: lease })
        .where(eq(reviewDispatchOutbox.id, row.id))
    return pending
  })
  let dispatched = 0
  for (const row of rows) {
    const owned = and(
      eq(reviewDispatchOutbox.id, row.id),
      eq(reviewDispatchOutbox.lockedUntil, lease),
    )
    try {
      await send({
        taskId: row.taskId,
        payload: row.payload as ReviewJob['payload'],
        options: row.options as ReviewJob['options'],
      })
      await db
        .update(reviewDispatchOutbox)
        .set({ dispatchedAt: new Date(), lockedUntil: null })
        .where(owned)
      dispatched++
    } catch {
      // An acknowledgement can be lost after acceptance. Reuse the same Trigger
      // idempotency key; never release quota for an ambiguously accepted job.
      await db
        .update(reviewDispatchOutbox)
        .set({
          attempts: row.attempts + 1,
          lockedUntil: null,
          nextAttemptAt: new Date(
            Date.now() + Math.min(3600, 15 * 2 ** Math.min(row.attempts, 8)) * 1000,
          ),
        })
        .where(owned)
      console.error('Review dispatch deferred; retrying from the durable outbox')
    }
  }
  return { dispatched }
}
