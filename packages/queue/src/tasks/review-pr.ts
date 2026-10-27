import { task } from '@trigger.dev/sdk/v3'
import { createInstallationOctokit, GitHubClient } from '@repo/github'
import { createDb } from '@repo/db'
import { findGitHubRepo } from '../lib/repository.js'
import { releaseReviewReservation, skipReview } from '../lib/review-reservation.js'
import {
  cachedReview,
  makeReviewKey,
  reviewIsCompleted,
  reviewMarker,
} from '../lib/review-state.js'
import { parseReviewBotConfig, reviewDiff, getModifiedLines, ReviewError, isFileIgnored } from '@repo/ai'
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
  githubRepoId?: number
  reservationKey?: string
}

const MAX_ATTEMPTS = 3

export const reviewPRTask = task({
  id: 'review-pull-request',
  queue: { concurrencyLimit: 1 },
  onFailure: async (payload: ReviewPRPayload) => { await releaseReviewReservation(createDb(undefined, 2), payload.reservationKey) },
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
    const db = createDb(undefined, 2)
    const repoRecord = await findGitHubRepo(db, installationId, repoFullName, payload.githubRepoId)
    if (repoRecord.isActive === false) return skipReview(db, payload.reservationKey, 'Repository is inactive')
    const reviewKey = makeReviewKey('github', repoRecord.id, prNumber, payload.headSha)
    if (await reviewIsCompleted(db, reviewKey))
      return skipReview(db, payload.reservationKey, 'Commit already reviewed')

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

    try {
      const currentPR = await githubClient.getPullRequest(owner, repo, prNumber)
      if (currentPR.headSha !== payload.headSha)
        return skipReview(db, payload.reservationKey, 'Superseded commit')
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
          if (getModifiedLines(file.patch).length > config.limits.max_file_size_lines) return false
          if (isFileIgnored(file.filename, config.ignore)) return false
          return true
        })
        .slice(0, config.limits.max_files_per_pr)

      if (reviewableFiles.length === 0) {
        return skipReview(db, payload.reservationKey, 'No files to review.')
      }

      const diffContent = reviewableFiles
        .map((file) => `File: ${file.filename}\nDiff:\n${file.patch}`)
        .join('\n\n')

      let reviewResult: Awaited<ReturnType<typeof reviewDiff>>
      try {
        reviewResult = await cachedReview(db, reviewKey, repoRecord.id, () =>
          reviewDiff(diffContent, config),
        )
      } catch (err) {
        // Non-retryable Claude errors fail immediately with a clear PR comment
        if (err instanceof ReviewError && !err.retryable) {
          console.error(`Non-retryable Claude error for ${repoFullName}#${prNumber}:`, err.message)
          await githubClient
            .createPRComment(
              owner,
              repo,
              prNumber,
              `> **AI Review Bot** could not complete the review.\n> Reason: ${err.message}\n\n_This is a permanent error and will not be retried._`,
            )
            .catch(() => {})
          if (repoRecord) {
            await saveFailedReview({
              db,
              repoId: repoRecord.id,
              provider: 'github',
              prNumber,
              prTitle,
              prAuthor,
              reviewUrl,
              errorMessage: err.message,
            })
          }
          await releaseReviewReservation(db, payload.reservationKey)
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

      const marker = reviewMarker(reviewKey)
      if (!(await githubClient.hasReviewMarker(owner, repo, prNumber, marker))) {
        if (githubComments.length > 0) {
          await githubClient.createReview(
            owner,
            repo,
            prNumber,
            `${summaryBody}\n\n${marker}`,
            'COMMENT',
            githubComments,
            payload.headSha,
          )
        } else {
          await githubClient.createPRComment(
            owner,
            repo,
            prNumber,
            `${summaryBody}\n\n*No inline comments or suggestions.*\n\n${marker}`,
          )
        }
      }

      await saveReviewAndNotify(
        {
          db,
          reviewKey,
          reservationKey: payload.reservationKey,
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
        await githubClient
          .createPRComment(
            owner,
            repo,
            prNumber,
            `> **AI Review Bot** failed to complete the review after ${MAX_ATTEMPTS} attempts.\n> Error: ${errorMessage}\n\n_Please check the bot configuration or contact support._`,
          )
          .catch(() => {})

        if (repoRecord) {
          await saveFailedReview({
            db,
            repoId: repoRecord.id,
            provider: 'github',
            prNumber,
            prTitle,
            prAuthor,
            reviewUrl,
            errorMessage,
          })
        }
      }

      throw error // Always re-throw so Trigger.dev tracks the failure
    }
  },
})
