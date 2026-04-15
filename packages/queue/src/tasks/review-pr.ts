import { task } from '@trigger.dev/sdk/v3'
import { createInstallationOctokit, GitHubClient } from '@repo/github'
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

export interface ReviewPRPayload {
  installationId: number
  repoFullName: string
  prNumber: number
  prTitle: string
  prAuthor: string
  headSha: string
}

export const reviewPRTask = task({
  id: 'review-pull-request',
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 30000,
  },
  run: async (payload: ReviewPRPayload) => {
    const { installationId, repoFullName, prNumber, prTitle, prAuthor } = payload
    const [owner, repo] = repoFullName.split('/')

    console.log(`Starting review for ${repoFullName}#${prNumber}`)

    const githubAppConfig = {
      appId: process.env.GITHUB_APP_ID!,
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
      webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
    }
    const octokit = await createInstallationOctokit(githubAppConfig, installationId)
    const githubClient = new GitHubClient(octokit)
    const db = createDb()

    const files = await githubClient.getPullRequestFiles(owner, repo, prNumber)
    const configYml = await githubClient.getFileContent(
      owner,
      repo,
      '.reviewbot.yml',
      payload.headSha,
    )
    const config = parseReviewBotConfig(configYml)

    const reviewableFiles = files
      .filter((file) => {
        if (file.status === 'removed') return false
        if (!file.patch) return false
        if (file.additions + file.deletions > config.limits.max_file_size_lines) return false
        if (config.ignore.some((ig) => file.filename.includes(ig.replace(/\*/g, '')))) return false
        return true
      })
      .slice(0, config.limits.max_files_per_pr)

    if (reviewableFiles.length === 0) {
      return { success: true, message: 'No files to review.' }
    }

    const diffContent = reviewableFiles
      .map((file) => `File: ${file.filename}\nDiff:\n${file.patch}`)
      .join('\n\n')

    const reviewResult = await reviewDiff(diffContent, config)

    const validComments: Array<{
      path: string
      line: number
      side: 'RIGHT'
      body: string
    }> = []
    const persistedComments: Array<{
      file: string
      line: number
      severity: 'bug' | 'suggestion' | 'nitpick' | 'praise'
      message: string
      suggestion?: string
    }> = []
    let bugsFound = 0

    for (const comment of reviewResult.comments) {
      const file = reviewableFiles.find((entry) => entry.filename === comment.file)
      if (!file?.patch) continue

      const modifiedLines = getModifiedLines(file.patch)
      if (!modifiedLines.includes(comment.line)) continue

      if (comment.severity === 'bug') {
        bugsFound++
      }

      let body = `**[${comment.severity.toUpperCase()}]** ${comment.message}`
      if (comment.suggestion) {
        body += `\n\n\`\`\`suggestion\n${comment.suggestion}\n\`\`\``
      }

      validComments.push({
        path: comment.file,
        line: comment.line,
        side: 'RIGHT',
        body,
      })
      persistedComments.push({
        file: comment.file,
        line: comment.line,
        severity: comment.severity,
        message: comment.message,
        suggestion: comment.suggestion,
      })
    }

    const summaryBody = `### AI Code Review Report\n**Score:** ${reviewResult.score}/100\n\n${reviewResult.summary}`
    const reviewUrl = `https://github.com/${repoFullName}/pull/${prNumber}`

    if (validComments.length > 0) {
      await githubClient.createReview(owner, repo, prNumber, summaryBody, 'COMMENT', validComments)
    } else {
      await githubClient.createPRComment(
        owner,
        repo,
        prNumber,
        `${summaryBody}\n\n*No inline comments or suggestions.*`,
      )
    }

    const repoRecord = await db.query.repositories.findFirst({
      where: eq(repositories.fullName, repoFullName),
    })

    if (!repoRecord) {
      console.log(`Repo ${repoFullName} not found in DB. Skipping DB persistence.`)
      return {
        success: true,
        repoFullName,
        prNumber,
        message: 'Review completed without DB persistence',
      }
    }

    const [savedReview] = await db
      .insert(reviews)
      .values({
        repoId: repoRecord.id,
        provider: 'github',
        prNumber,
        prTitle,
        prAuthor,
        reviewUrl,
        summary: reviewResult.summary,
        status: 'completed',
        tokensInput: reviewResult.tokensUsed,
        tokensOutput: 0,
        commentsPosted: validComments.length,
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
      provider: 'github',
      repository: repoFullName,
      reviewNumber: prNumber,
      title: prTitle,
      author: prAuthor,
      score: reviewResult.score,
      bugsFound,
      commentsPosted: validComments.length,
      reviewUrl,
      summary: reviewResult.summary,
    }).catch((error) => {
      console.error('Slack notification failed (non-fatal):', error)
    })

    return {
      success: true,
      repoFullName,
      prNumber,
      message: 'AI review executed successfully',
    }
  },
})
