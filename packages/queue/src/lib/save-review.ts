import {
  type Database,
  notificationOutbox,
  organizations,
  repositories,
  reviewComments,
  reviewReservations,
  reviews,
  and,
  eq,
  sql,
} from '@repo/db'
import type { ReviewResult, ReviewTokenUsage } from '@repo/ai'
import { type SlackReviewNotificationPayload } from './slack.js'
import { drainNotificationOutbox } from './notification-outbox.js'

export interface FailedReviewInput {
  db: Database
  repoId: string
  provider: 'github' | 'gitlab' | 'bitbucket'
  prNumber: number
  prTitle: string | null
  prAuthor: string | null
  reviewUrl: string | null
  errorMessage: string
}

/**
 * Persist a failed review record so the dashboard can show it.
 * Non-throwing — any DB error is logged but not re-raised.
 */
export async function saveFailedReview(input: FailedReviewInput): Promise<void> {
  const { db, repoId, provider, prNumber, prTitle, prAuthor, reviewUrl, errorMessage } = input
  try {
    await db.insert(reviews).values({
      repoId,
      provider,
      prNumber,
      prTitle,
      prAuthor,
      reviewUrl,
      status: 'failed',
      tokensInput: 0,
      tokensOutput: 0,
      commentsPosted: 0,
      bugsFound: 0,
      errorMessage: errorMessage.slice(0, 1000), // cap length
      completedAt: new Date(),
    })
  } catch (err) {
    console.error('Could not save failed review record:', err)
  }
}

export interface PersistedComment {
  file: string
  line: number
  severity: 'bug' | 'suggestion' | 'nitpick' | 'praise'
  message: string
  suggestion?: string
}

export interface SaveReviewInput {
  db: Database
  repoId: string
  provider: 'github' | 'gitlab' | 'bitbucket'
  prNumber: number
  prTitle: string | null
  prAuthor: string | null
  reviewUrl: string | null
  reviewResult: ReviewResult & ReviewTokenUsage
  persistedComments: PersistedComment[]
  commentsPosted: number
  bugsFound: number
  orgId: string
  reviewKey: string
  reservationKey?: string
}

/**
 * Commit the review, quota completion and deliveries together, then attempt delivery.
 */
export async function saveReviewAndNotify(
  input: SaveReviewInput,
  slackPayload: Omit<
    SlackReviewNotificationPayload,
    'score' | 'bugsFound' | 'commentsPosted' | 'summary'
  >,
): Promise<void> {
  const {
    db,
    repoId,
    provider,
    prNumber,
    prTitle,
    prAuthor,
    reviewUrl,
    reviewResult,
    persistedComments,
    commentsPosted,
    bugsFound,
    orgId,
    reviewKey,
  } = input

  const savedReview = await db.transaction(async (tx) => {
    // Serialize completion counts per organization, including simultaneous PRs.
    const [orgRecord] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .for('update')
    if (!orgRecord) throw new Error('Review organization no longer exists')
    const [inserted] = await tx
      .insert(reviews)
      .values({
        repoId,
        reviewKey,
        provider,
        prNumber,
        prTitle,
        prAuthor,
        reviewUrl,
        summary: reviewResult.summary,
        status: 'completed',
        tokensInput: reviewResult.tokensInput,
        tokensOutput: reviewResult.tokensOutput,
        commentsPosted,
        bugsFound,
        score: reviewResult.score,
        completedAt: new Date(),
      })
      .onConflictDoNothing({ target: reviews.reviewKey })
      .returning({ id: reviews.id })

    if (input.reservationKey) {
      await tx
        .update(reviewReservations)
        .set({ status: 'completed' })
        .where(eq(reviewReservations.reservationKey, input.reservationKey))
    }
    if (!inserted) return null

    if (persistedComments.length > 0) {
      await tx.insert(reviewComments).values(
        persistedComments.map((c) => ({
          reviewId: inserted.id,
          file: c.file,
          line: c.line,
          severity: c.severity,
          message: c.message,
          suggestion: c.suggestion,
        })),
      )
    }
    const monthStart = new Date()
    monthStart.setUTCDate(1)
    monthStart.setUTCHours(0, 0, 0, 0)
    const [usage] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(reviews)
      .innerJoin(repositories, eq(reviews.repoId, repositories.id))
      .where(
        and(
          eq(repositories.orgId, orgId),
          eq(reviews.status, 'completed'),
          sql`${reviews.completedAt} >= ${monthStart}`,
        ),
      )
    if (orgRecord.plan === 'team' && orgRecord.stripeCustomerId && usage.total > 500) {
      await tx.insert(notificationOutbox).values({
        id: `stripe:${inserted.id}`,
        reviewId: inserted.id,
        kind: 'stripe',
        payload: {
          customerId: orgRecord.stripeCustomerId,
          reviewKey,
          timestamp: Math.floor(Date.now() / 1000),
        },
      })
    }
    const webhookUrl = orgRecord.slackWebhookUrl ?? process.env.SLACK_WEBHOOK_URL
    if (webhookUrl)
      await tx.insert(notificationOutbox).values({
        id: `slack:${inserted.id}`,
        reviewId: inserted.id,
        kind: 'slack',
        payload: {
          webhookUrl,
          notification: {
            ...slackPayload,
            score: reviewResult.score,
            bugsFound,
            commentsPosted,
            summary: reviewResult.summary,
          },
        },
      })
    return inserted
  })
  if (savedReview)
    await drainNotificationOutbox(db, savedReview.id).catch(() => {
      console.error('Notification delivery deferred to scheduled retry')
    })
}

/**
 * Upsert a GitLab organization + repository record, returning the repo row.
 * Called when a MR fires for a repo not yet in the DB.
 */
export async function upsertGitLabRepo(
  db: Database,
  params: {
    projectId: number
    projectPath: string
    projectWebUrl?: string
    rootNamespace?: string
  },
): Promise<typeof repositories.$inferSelect> {
  const { projectId, projectPath, projectWebUrl, rootNamespace } = params

  const orgName = projectPath.split('/')[0] ?? rootNamespace ?? 'GitLab'
  const [org] = await db
    .insert(organizations)
    .values({ name: orgName, gitlabNamespace: orgName, plan: 'free' })
    .onConflictDoUpdate({ target: organizations.gitlabNamespace, set: { name: orgName } })
    .returning()

  const [repo] = await db
    .insert(repositories)
    .values({
      orgId: org.id,
      provider: 'gitlab',
      gitlabProjectId: String(projectId),
      fullName: projectPath,
      webUrl: projectWebUrl ?? projectPath,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: repositories.gitlabProjectId,
      set: { orgId: org.id, fullName: projectPath, webUrl: projectWebUrl ?? projectPath },
    })
    .returning()

  return repo
}

/** Format a review comment body with severity badge and optional suggestion. */
export function formatCommentBody(severity: string, message: string, suggestion?: string): string {
  let body = `**[${severity.toUpperCase()}]** ${message}`
  if (suggestion) {
    body += `\n\n\`\`\`suggestion\n${suggestion}\n\`\`\``
  }
  return body
}
