import { task } from '@trigger.dev/sdk/v3'
import { GitLabClient } from '@repo/gitlab'
import type { GitLabMergeRequestChange } from '@repo/gitlab'
import {
  createDb,
  organizations,
  repositories,
  reviewComments,
  reviews,
  eq,
} from '@repo/db'
import { parseReviewBotConfig, reviewDiff, getModifiedLines } from '@repo/ai'
import { reportPRReviewToMeter } from '../lib/stripe-meter.js'
import { sendSlackReviewNotification } from '../lib/slack.js'

export interface ReviewMergeRequestPayload {
  projectId: number
  projectPath: string
  projectWebUrl?: string
  mergeRequestIid: number
  mergeRequestTitle: string
  mergeRequestAuthor: string
  rootNamespace?: string
}

export const reviewMergeRequestTask = task({
  id: 'review-merge-request',
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 30000,
  },
  run: async (payload: ReviewMergeRequestPayload) => {
    const db = createDb()
    const gitlabClient = new GitLabClient({
      baseUrl: process.env.GITLAB_API_URL ?? 'https://gitlab.com/api/v4',
      token: process.env.GITLAB_TOKEN!,
    })

    const mergeRequest = await gitlabClient.getMergeRequest(payload.projectId, payload.mergeRequestIid)
    const changes = await gitlabClient.getMergeRequestChanges(payload.projectId, payload.mergeRequestIid)
    const configYml = await gitlabClient.getFileContent(
      payload.projectId,
      '.reviewbot.yml',
      mergeRequest.diffRefs.headSha,
    )
    const config = parseReviewBotConfig(configYml)

    const reviewableFiles = changes
      .filter((file: GitLabMergeRequestChange) => {
        if (file.deletedFile) return false
        if (!file.diff) return false
        if (config.ignore.some((ig) => file.newPath.includes(ig.replace(/\*/g, '')))) return false
        if (getModifiedLines(file.diff).length > config.limits.max_file_size_lines) return false
        return true
      })
      .slice(0, config.limits.max_files_per_pr)

    if (reviewableFiles.length === 0) {
      return { success: true, message: 'No files to review.' }
    }

    const diffContent = reviewableFiles
      .map((file: GitLabMergeRequestChange) => `File: ${file.newPath}\nDiff:\n${file.diff}`)
      .join('\n\n')

    const reviewResult = await reviewDiff(diffContent, config)
    const persistedComments: Array<{
      file: string
      line: number
      severity: 'bug' | 'suggestion' | 'nitpick' | 'praise'
      message: string
      suggestion?: string
    }> = []
    let commentsPosted = 0
    let bugsFound = 0

    for (const comment of reviewResult.comments) {
      const file = reviewableFiles.find((entry: GitLabMergeRequestChange) => entry.newPath === comment.file)
      if (!file?.diff) continue

      const modifiedLines = getModifiedLines(file.diff)
      if (!modifiedLines.includes(comment.line)) continue

      if (comment.severity === 'bug') {
        bugsFound++
      }

      let body = `**[${comment.severity.toUpperCase()}]** ${comment.message}`
      if (comment.suggestion) {
        body += `\n\n\`\`\`suggestion\n${comment.suggestion}\n\`\`\``
      }

      try {
        await gitlabClient.createInlineDiscussion(payload.projectId, payload.mergeRequestIid, {
          body,
          oldPath: file.oldPath,
          newPath: file.newPath,
          newLine: comment.line,
          baseSha: mergeRequest.diffRefs.baseSha,
          startSha: mergeRequest.diffRefs.startSha,
          headSha: mergeRequest.diffRefs.headSha,
        })
        commentsPosted++
        persistedComments.push({
          file: comment.file,
          line: comment.line,
          severity: comment.severity,
          message: comment.message,
          suggestion: comment.suggestion,
        })
      } catch (error) {
        console.warn(`Skipped GitLab inline comment for ${comment.file}:${comment.line}`, error)
      }
    }

    await gitlabClient.createMergeRequestNote(
      payload.projectId,
      payload.mergeRequestIid,
      `### AI Code Review Report
**Score:** ${reviewResult.score}/100

${reviewResult.summary}

${commentsPosted > 0 ? `Posted ${commentsPosted} inline comments.` : '*No inline comments or suggestions.*'}`,
    )

    let repoRecord = await db.query.repositories.findFirst({
      where: eq(repositories.gitlabProjectId, String(payload.projectId)),
    })

    if (!repoRecord) {
      const orgName = payload.rootNamespace ?? payload.projectPath.split('/')[0] ?? 'GitLab'
      let orgRecord = await db.query.organizations.findFirst({
        where: eq(organizations.name, orgName),
      })

      if (!orgRecord) {
        ;[orgRecord] = await db
          .insert(organizations)
          .values({
            name: orgName,
            plan: 'free',
          })
          .returning()
      }

      ;[repoRecord] = await db
        .insert(repositories)
        .values({
          orgId: orgRecord.id,
          provider: 'gitlab',
          githubRepoId: `gitlab:${payload.projectId}`,
          gitlabProjectId: String(payload.projectId),
          fullName: payload.projectPath,
          webUrl: payload.projectWebUrl ?? payload.projectPath,
          isActive: true,
        })
        .returning()
    }

    const [savedReview] = await db
      .insert(reviews)
      .values({
        repoId: repoRecord.id,
        provider: 'gitlab',
        prNumber: payload.mergeRequestIid,
        prTitle: payload.mergeRequestTitle,
        prAuthor: payload.mergeRequestAuthor,
        reviewUrl: mergeRequest.webUrl,
        summary: reviewResult.summary,
        status: 'completed',
        tokensInput: reviewResult.tokensUsed,
        tokensOutput: 0,
        commentsPosted,
        bugsFound,
        score: reviewResult.score,
        completedAt: new Date(),
      })
      .returning({ id: reviews.id })

    if (persistedComments.length > 0) {
      await db.insert(reviewComments).values(
        persistedComments.map((comment) => ({
          reviewId: savedReview.id,
          file: comment.file,
          line: comment.line,
          severity: comment.severity,
          message: comment.message,
          suggestion: comment.suggestion,
        })),
      )
    }

    const orgRecord = await db
      .select({ stripeCustomerId: organizations.stripeCustomerId })
      .from(organizations)
      .where(eq(organizations.id, repoRecord.orgId))
      .limit(1)
      .then((rows) => rows[0])

    await reportPRReviewToMeter(orgRecord?.stripeCustomerId ?? null)
    await sendSlackReviewNotification({
      provider: 'gitlab',
      repository: payload.projectPath,
      reviewNumber: payload.mergeRequestIid,
      title: payload.mergeRequestTitle,
      author: payload.mergeRequestAuthor,
      score: reviewResult.score,
      bugsFound,
      commentsPosted,
      reviewUrl: mergeRequest.webUrl,
      summary: reviewResult.summary,
    }).catch((error) => {
      console.error('Slack notification failed (non-fatal):', error)
    })

    return {
      success: true,
      projectPath: payload.projectPath,
      mergeRequestIid: payload.mergeRequestIid,
      message: 'GitLab merge request reviewed successfully',
    }
  },
})
