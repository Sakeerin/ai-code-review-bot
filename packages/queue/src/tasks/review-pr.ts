import { task } from '@trigger.dev/sdk/v3'
import { createInstallationOctokit, GitHubClient } from '@repo/github'
import { createDb, repositories, eq } from '@repo/db'
import { parseReviewBotConfig, reviewDiff, getModifiedLines, ReviewError } from '@repo/ai'
import {
  saveReviewAndNotify,
  saveFailedReview,
  formatCommentBody,
  type PersistedComment,
} from '../lib/save-review.js'

export interface ReviewPRPayload {
  installationId: number
  repoFullName: string
  prNumber: number
  prTitle: string
  prAuthor: string
  headSha: string
}

const MAX_ATTEMPTS = 3

export const reviewPRTask = task({
  id: 'review-pull-request',
  retry: {
    maxAttempts: MAX_ATTEMPTS,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 30000,
  },
  run: async (payload: ReviewPRPayload, { ctx }) => {
    const { installationId, repoFullName, prNumber, prTitle, prAuthor } = payload
    const [owner, repo] = repoFullName.split('/')
    const isLastAttempt = ctx.attempt.number >= MAX_ATTEMPTS
    const reviewUrl = `https://github.com/${repoFullName}/pull/${prNumber}`

    console.log(`[attempt ${ctx.attempt.number}] Starting review for ${repoFullName}#${prNumber}`)

    const octokit = await createInstallationOctokit(
      {
        appId: process.env.GITHUB_APP_ID!,
        privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
        webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
      },
      installationId,
    )
    const githubClient = new GitHubClient(octokit)
    const db = createDb(undefined, 2)

    try {
      const files = await githubClient.getPullRequestFiles(owner, repo, prNumber)
      const configYml = await githubClient.getFileContent(owner, repo, '.reviewbot.yml', payload.headSha)
      const config = parseReviewBotConfig(configYml)

      const reviewableFiles = files
        .filter((file) => {
          if (file.status === 'removed') return false
          if (!file.patch) return false
          if (getModifiedLines(file.patch).length > config.limits.max_file_size_lines) return false
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

      let reviewResult: Awaited<ReturnType<typeof reviewDiff>>
      try {
        reviewResult = await reviewDiff(diffContent, config)
      } catch (err) {
        // Non-retryable Claude errors fail immediately with a clear PR comment
        if (err instanceof ReviewError && !err.retryable) {
          console.error(`Non-retryable Claude error for ${repoFullName}#${prNumber}:`, err.message)
          await githubClient.createPRComment(owner, repo, prNumber,
            `> **AI Review Bot** could not complete the review.\n> Reason: ${err.message}\n\n_This is a permanent error and will not be retried._`,
          ).catch(() => {})
          const repoRecord = await db.query.repositories.findFirst({ where: eq(repositories.fullName, repoFullName) }).catch(() => null)
          if (repoRecord) {
            await saveFailedReview({ db, repoId: repoRecord.id, provider: 'github', prNumber, prTitle, prAuthor, reviewUrl, errorMessage: err.message })
          }
          return { success: false, repoFullName, prNumber, message: err.message }
        }
        throw err // Retryable — let Trigger.dev retry with backoff
      }

      const githubComments: Array<{ path: string; line: number; side: 'RIGHT'; body: string }> = []
      const persistedComments: PersistedComment[] = []
      let bugsFound = 0

      for (const comment of reviewResult.comments) {
        const file = reviewableFiles.find((f) => f.filename === comment.file)
        if (!file?.patch) continue
        if (!getModifiedLines(file.patch).includes(comment.line)) continue

        if (comment.severity === 'bug') bugsFound++

        githubComments.push({
          path: comment.file,
          line: comment.line,
          side: 'RIGHT',
          body: formatCommentBody(comment.severity, comment.message, comment.suggestion),
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

      if (githubComments.length > 0) {
        await githubClient.createReview(owner, repo, prNumber, summaryBody, 'COMMENT', githubComments)
      } else {
        await githubClient.createPRComment(owner, repo, prNumber, `${summaryBody}\n\n*No inline comments or suggestions.*`)
      }

      const repoRecord = await db.query.repositories.findFirst({
        where: eq(repositories.fullName, repoFullName),
      })

      if (!repoRecord) {
        console.log(`Repo ${repoFullName} not found in DB — skipping persistence.`)
        return { success: true, repoFullName, prNumber, message: 'Review completed without DB persistence' }
      }

      await saveReviewAndNotify(
        {
          db,
          repoId: repoRecord.id,
          provider: 'github',
          prNumber,
          prTitle,
          prAuthor,
          reviewUrl,
          reviewResult,
          persistedComments,
          commentsPosted: githubComments.length,
          bugsFound,
          orgId: repoRecord.orgId,
        },
        {
          provider: 'github',
          repository: repoFullName,
          reviewNumber: prNumber,
          title: prTitle,
          author: prAuthor,
          reviewUrl,
        },
      )

      return { success: true, repoFullName, prNumber, message: 'AI review executed successfully' }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(
        `[attempt ${ctx.attempt.number}/${MAX_ATTEMPTS}] Review failed for ${repoFullName}#${prNumber}:`,
        errorMessage,
      )

      // On last attempt: post visible error comment + save failed record
      if (isLastAttempt) {
        await githubClient.createPRComment(
          owner, repo, prNumber,
          `> **AI Review Bot** failed to complete the review after ${MAX_ATTEMPTS} attempts.\n> Error: ${errorMessage}\n\n_Please check the bot configuration or contact support._`,
        ).catch(() => {})

        const repoRecord = await db.query.repositories
          .findFirst({ where: eq(repositories.fullName, repoFullName) })
          .catch(() => null)

        if (repoRecord) {
          await saveFailedReview({
            db, repoId: repoRecord.id, provider: 'github',
            prNumber, prTitle, prAuthor, reviewUrl, errorMessage,
          })
        }
      }

      throw error // Always re-throw so Trigger.dev tracks the failure
    }
  },
})
