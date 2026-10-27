import { type Database, reviewReservations, rateLimits, and, eq, sql } from '@repo/db'

export async function skipReview(db: Database, key: string | undefined, message: string) {
  await releaseReviewReservation(db, key)
  return { success: true, message }
}

export async function releaseReviewReservation(db: Database, key?: string): Promise<void> {
  if (!key) return
  await db.transaction(async (tx) => {
    const reservation = await tx.query.reviewReservations.findFirst({
      where: eq(reviewReservations.reservationKey, key),
    })
    if (!reservation || reservation.status !== 'reserved') return
    await tx.execute(
      sql`SELECT id FROM rate_limits WHERE org_key = ${reservation.orgKey} AND month_key = ${reservation.monthKey} FOR UPDATE`,
    )
    const released = await tx
      .update(reviewReservations)
      .set({ status: 'released' })
      .where(
        and(eq(reviewReservations.reservationKey, key), eq(reviewReservations.status, 'reserved')),
      )
      .returning()
    if (!released.length) return
    await tx
      .update(rateLimits)
      .set({
        used: sql`GREATEST(0, ${rateLimits.used} - 1)`,
        overageUsed: sql`CASE WHEN ${rateLimits.plan} = 'team' THEN GREATEST(0, ${rateLimits.used} - 1 - 500) ELSE 0 END`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(rateLimits.orgKey, reservation.orgKey),
          eq(rateLimits.monthKey, reservation.monthKey),
        ),
      )
  })
}
