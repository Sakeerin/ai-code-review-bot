import {
  type Database,
  organizations,
  repositories,
  reviewComments,
  reviews,
  eq,
} from '@repo/db'
import type { ReviewResult, ReviewTokenUsage } from '@repo/ai'
import { reportPRReviewToMeter } from './stripe-meter.js'
import { sendSlackReviewNotification, type SlackReviewNotificationPayload } from './slack.js'

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
  provider: 'github' | 'gitlab'
  prNumber: number
  prTitle: string | null
  prAuthor: string | null
  reviewUrl: string | null
  reviewResult: ReviewResult & ReviewTokenUsage
  persistedComments: PersistedComment[]
  commentsPosted: number
  bugsFound: number
  orgId: string
}

/**
 * Shared post-review logic: save to DB, report Stripe meter, send Slack.
 * Used by both review-pr and review-merge-request tasks.
 */
export async function saveReviewAndNotify(
  input: SaveReviewInput,
  slackPayload: Omit<SlackReviewNotificationPayload, 'score' | 'bugsFound' | 'commentsPosted' | 'summary'>,
): Promise<void> {
  const {
    db, repoId, provider, prNumber, prTitle, prAuthor, reviewUrl,
    reviewResult, persistedComments, commentsPosted, bugsFound, orgId,
  } = input

  const [savedReview] = await db
    .insert(reviews)
    .values({
      repoId,
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
    .returning({ id: reviews.id })

  if (persistedComments.length > 0) {
    await db.insert(reviewComments).values(
      persistedComments.map((c) => ({
        reviewId: savedReview.id,
        file: c.file,
        line: c.line,
        severity: c.severity,
        message: c.message,
        suggestion: c.suggestion,
      })),
    )
  }

  const orgRecord = await db
    .select({ stripeCustomerId: organizations.stripeCustomerId })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1)
    .then((rows) => rows[0])

  await reportPRReviewToMeter(orgRecord?.stripeCustomerId ?? null)

  await sendSlackReviewNotification({
    ...slackPayload,
    score: reviewResult.score,
    bugsFound,
    commentsPosted,
    summary: reviewResult.summary,
  }).catch((err) => {
    console.error('Slack notification failed (non-fatal):', err)
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

  const existing = await db.query.repositories.findFirst({
    where: eq(repositories.gitlabProjectId, String(projectId)),
  })
  if (existing) return existing

  const orgName = rootNamespace ?? projectPath.split('/')[0] ?? 'GitLab'
  let org = await db.query.organizations.findFirst({
    where: eq(organizations.name, orgName),
  })
  if (!org) {
    ;[org] = await db
      .insert(organizations)
      .values({ name: orgName, plan: 'free' })
      .returning()
  }

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
    .returning()

  return repo
}

/** Format a review comment body with severity badge and optional suggestion. */
export function formatCommentBody(
  severity: string,
  message: string,
  suggestion?: string,
): string {
  let body = `**[${severity.toUpperCase()}]** ${message}`
  if (suggestion) {
    body += `\n\n\`\`\`suggestion\n${suggestion}\n\`\`\``
  }
  return body
}
