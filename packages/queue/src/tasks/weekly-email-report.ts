import { schedules } from '@trigger.dev/sdk/v3'
import { createDb, organizations, repositories, reviews, eq, and, gte, lte, sql } from '@repo/db'
import { sendWeeklyReport } from '../lib/email.js'

/**
 * Weekly PR trend report — runs every Monday at 09:00 UTC.
 * Sends an HTML email to each org that has email reports enabled.
 */
export const weeklyEmailReportTask = schedules.task({
  id: 'weekly-email-report',
  cron: '0 9 * * 1', // Monday 09:00 UTC
  run: async () => {
    const db = createDb(undefined, 2)

    // Date range: last 7 days (Mon–Sun previous week)
    const now = new Date()
    const weekEnd = new Date(now)
    weekEnd.setUTCHours(0, 0, 0, 0)
    const weekStart = new Date(weekEnd)
    weekStart.setDate(weekStart.getDate() - 7)

    const weekStartStr = weekStart.toISOString().slice(0, 10)
    const weekEndStr = weekEnd.toISOString().slice(0, 10)

    // Fetch all orgs with email reports enabled
    const orgs = await db
      .select()
      .from(organizations)
      .where(eq(organizations.emailReportEnabled, true))

    console.log(`Weekly email report: ${orgs.length} orgs to notify`)

    for (const org of orgs) {
      if (!org.emailReportRecipients) continue
      const recipients = org.emailReportRecipients
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean)
      if (recipients.length === 0) continue

      try {
        // Fetch repos for this org
        const orgRepos = await db
          .select({ id: repositories.id, fullName: repositories.fullName })
          .from(repositories)
          .where(and(eq(repositories.orgId, org.id), eq(repositories.isActive, true)))

        if (orgRepos.length === 0) continue

        const repoIds = orgRepos.map((r) => r.id)

        // Aggregate: total reviews, bugs, avg score in the week
        const totals = await db
          .select({
            totalReviews: sql<number>`count(*)::int`,
            totalBugsFound: sql<number>`coalesce(sum(${reviews.bugsFound}), 0)::int`,
            avgScore: sql<number | null>`avg(${reviews.score})`,
          })
          .from(reviews)
          .where(and(
            sql`${reviews.repoId} = ANY(${sql.raw(`ARRAY[${repoIds.map((id) => `'${id}'`).join(',')}]::uuid[]`)})`,
            eq(reviews.status, 'completed'),
            gte(reviews.createdAt, weekStart),
            lte(reviews.createdAt, weekEnd),
          ))
          .then((rows) => rows[0])

        // Per-repo breakdown
        const repoStats = await Promise.all(
          orgRepos.map(async (repo) => {
            const stats = await db
              .select({
                reviewCount: sql<number>`count(*)::int`,
                bugsFound: sql<number>`coalesce(sum(${reviews.bugsFound}), 0)::int`,
                avgScore: sql<number | null>`avg(${reviews.score})`,
              })
              .from(reviews)
              .where(and(
                eq(reviews.repoId, repo.id),
                eq(reviews.status, 'completed'),
                gte(reviews.createdAt, weekStart),
                lte(reviews.createdAt, weekEnd),
              ))
              .then((rows) => rows[0])

            return {
              fullName: repo.fullName,
              reviewCount: stats?.reviewCount ?? 0,
              bugsFound: stats?.bugsFound ?? 0,
              avgScore: stats?.avgScore ?? null,
            }
          }),
        )

        const topRepos = repoStats
          .filter((r) => r.reviewCount > 0)
          .sort((a, b) => b.reviewCount - a.reviewCount)
          .slice(0, 10)

        if ((totals?.totalReviews ?? 0) === 0) {
          console.log(`No reviews for ${org.name} this week — skipping email`)
          continue
        }

        await sendWeeklyReport({
          orgName: org.name,
          weekStart: weekStartStr,
          weekEnd: weekEndStr,
          totalReviews: totals?.totalReviews ?? 0,
          totalBugsFound: totals?.totalBugsFound ?? 0,
          avgScore: totals?.avgScore ?? null,
          topRepos,
          recipients,
        })

        console.log(`Sent weekly report to ${recipients.length} recipient(s) for ${org.name}`)
      } catch (err) {
        console.error(`Failed to send weekly report for org ${org.name}:`, err)
        // Continue with next org — don't fail the whole task
      }
    }

    return { processed: orgs.length, weekStart: weekStartStr, weekEnd: weekEndStr }
  },
})
