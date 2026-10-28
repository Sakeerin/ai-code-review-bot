import { task } from '@trigger.dev/sdk/v3'
import { BitbucketClient } from '@repo/bitbucket'
import { createDb } from '@repo/db'
import { upsertBitbucketRepo } from '../lib/repository.js'
import { releaseReviewReservation, skipReview } from '../lib/review-reservation.js'
import {
  cachedReview,
  makeReviewKey,
  reviewIsCompleted,
  reviewMarker,
} from '../lib/review-state.js'
import {
  parseReviewBotConfig,
  reviewDiff,
  getModifiedLines,
  ReviewError,
  isFileIgnored,
} from '@repo/ai'
import {
  saveReviewAndNotify,
  saveFailedReview,
  formatCommentBody,
  type PersistedComment,
} from '../lib/save-review.js'

export interface ReviewBitbucketPRPayload {
  workspace: string
  repoSlug: string
  repoFullName: string
  prId: number
  prTitle: string
  prAuthor: string
  headCommitHash: string
  prUrl: string
  /** Only accepted for already queued jobs; new jobs read worker credentials. */
  bitbucketUsername?: string
  bitbucketAppPassword?: string
  reservationKey?: string
}

const MAX_ATTEMPTS = 3

export const reviewBitbucketPRTask = task({
  id: 'review-bitbucket-pull-request',
  queue: { concurrencyLimit: 1 },
  onFailure: async ({ payload }: { payload: ReviewBitbucketPRPayload }) => {
    await releaseReviewReservation(createDb(undefined, 2), payload.reservationKey)
  },
  retry: {
    maxAttempts: MAX_ATTEMPTS,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 30000,
  },
  run: async (payload: ReviewBitbucketPRPayload, { ctx }) => {
    const {
      workspace,
      repoSlug,
      repoFullName,
      prId,
      prTitle,
      prAuthor,
      headCommitHash,
      prUrl,
      bitbucketUsername,
      bitbucketAppPassword,
    } = payload
    const isLastAttempt = ctx.attempt.number >= MAX_ATTEMPTS

    console.log(
      `[attempt ${ctx.attempt.number}] Starting Bitbucket review for ${repoFullName}#${prId}`,
    )

    const db = createDb(undefined, 2)
    const repoRecord = await upsertBitbucketRepo(db, workspace, repoFullName)
    if (repoRecord.isActive === false)
      return skipReview(db, payload.reservationKey, 'Repository is inactive')
    const reviewKey = makeReviewKey('bitbucket', repoRecord.id, prId, headCommitHash)
    if (await reviewIsCompleted(db, reviewKey))
      return skipReview(db, payload.reservationKey, 'Commit already reviewed')
    const bbClient = new BitbucketClient({
      apiToken: process.env.BITBUCKET_API_TOKEN,
      username: process.env.BITBUCKET_USERNAME || bitbucketUsername,
      appPassword: process.env.BITBUCKET_APP_PASSWORD || bitbucketAppPassword,
    })

    try {
      const currentPR = await bbClient.getPullRequest(workspace, repoSlug, prId)
      if (currentPR.source.commit.hash !== headCommitHash)
        return skipReview(db, payload.reservationKey, 'Superseded commit')
      const [files, diffText, configYml] = await Promise.all([
        bbClient.getPullRequestFiles(workspace, repoSlug, prId),
        bbClient.getPullRequestDiff(workspace, repoSlug, prId),
        bbClient.getFileContent(workspace, repoSlug, '.reviewbot.yml', headCommitHash),
      ])

      const config = parseReviewBotConfig(configYml)

      // Parse per-file patches from the unified diff
      const filePatchMap = parseDiffByFile(diffText)

      const reviewableFiles = files
        .filter((f) => {
          if (f.status === 'removed') return false
          if (!filePatchMap.has(f.newPath)) return false
          const patch = filePatchMap.get(f.newPath)!
          if (getModifiedLines(patch).length > config.limits.max_file_size_lines) return false
          if (isFileIgnored(f.newPath, config.ignore)) return false
          return true
        })
        .slice(0, config.limits.max_files_per_pr)

      if (reviewableFiles.length === 0) {
        return skipReview(db, payload.reservationKey, 'No files to review.')
      }

      const diffContent = reviewableFiles
        .map((f) => `File: ${f.newPath}\nDiff:\n${filePatchMap.get(f.newPath)}`)
        .join('\n\n')

      let reviewResult: Awaited<ReturnType<typeof reviewDiff>>
      try {
        reviewResult = await cachedReview(db, reviewKey, repoRecord.id, () =>
          reviewDiff(diffContent, config),
        )
      } catch (err) {
        if (err instanceof ReviewError && !err.retryable) {
          await bbClient
            .createPRComment(
              workspace,
              repoSlug,
              prId,
              `> **AI Review Bot** could not complete the review.\n> Reason: ${(err as Error).message}\n\n_This is a permanent error and will not be retried._`,
            )
            .catch(() => {})
          if (repoRecord) {
            await saveFailedReview({
              db,
              repoId: repoRecord.id,
              provider: 'bitbucket',
              prNumber: prId,
              prTitle,
              prAuthor,
              reviewUrl: prUrl,
              errorMessage: (err as Error).message,
            })
          }
          await releaseReviewReservation(db, payload.reservationKey)
          return { success: false, repoFullName, prId, message: (err as Error).message }
        }
        throw err
      }

      const persistedComments: PersistedComment[] = []
      let commentsPosted = 0
      let bugsFound = 0
      const existingBodies = await bbClient.getCommentBodies(workspace, repoSlug, prId)

      for (const comment of reviewResult.comments) {
        const file = reviewableFiles.find((f) => f.newPath === comment.file)
        if (!file) continue
        const patch = filePatchMap.get(file.newPath)
        if (!patch) continue
        if (!getModifiedLines(patch).includes(comment.line)) continue

        if (comment.severity === 'bug') bugsFound++

        const marker = reviewMarker(reviewKey, `comment-${reviewResult.comments.indexOf(comment)}`)
        const body = `${formatCommentBody(comment.severity, comment.message, comment.suggestion)}\n\n${marker}`
        try {
          if (!existingBodies.some((text) => text.includes(marker))) {
            await bbClient.createInlineComment(
              workspace,
              repoSlug,
              prId,
              body,
              comment.file,
              comment.line,
            )
          }
          commentsPosted++
          persistedComments.push({
            file: comment.file,
            line: comment.line,
            severity: comment.severity,
            message: comment.message,
            suggestion: comment.suggestion,
          })
        } catch (err) {
          if (![400, 422].includes((err as { status?: number }).status ?? 0)) throw err
          console.warn(`Skipped Bitbucket inline comment for ${comment.file}:${comment.line}`, err)
        }
      }

      const summaryBody = `### AI Code Review Report\n**Score:** ${reviewResult.score}/100\n\n${reviewResult.summary}\n\n${commentsPosted > 0 ? `Posted ${commentsPosted} inline comment(s).` : '*No inline comments or suggestions.*'}`
      const summaryMarker = reviewMarker(reviewKey)
      if (!existingBodies.some((text) => text.includes(summaryMarker))) {
        await bbClient.createPRComment(
          workspace,
          repoSlug,
          prId,
          `${summaryBody}\n\n${summaryMarker}`,
        )
      }

      await saveReviewAndNotify(
        {
          db,
          reviewKey,
          reservationKey: payload.reservationKey,
          repoId: repoRecord.id,
          provider: 'bitbucket',
          prNumber: prId,
          prTitle,
          prAuthor,
          reviewUrl: prUrl,
          reviewResult,
          persistedComments,
          commentsPosted,
          bugsFound,
          orgId: repoRecord.orgId,
        },
        {
          provider: 'bitbucket',
          repository: repoFullName,
          reviewNumber: prId,
          title: prTitle,
          author: prAuthor,
          reviewUrl: prUrl,
        },
      )

      return { success: true, repoFullName, prId, message: 'Bitbucket PR reviewed successfully' }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(
        `[attempt ${ctx.attempt.number}/${MAX_ATTEMPTS}] Bitbucket review failed for ${repoFullName}#${prId}:`,
        errorMessage,
      )

      if (isLastAttempt) {
        await bbClient
          .createPRComment(
            workspace,
            repoSlug,
            prId,
            `> **AI Review Bot** failed to complete the review after ${MAX_ATTEMPTS} attempts.\n> Error: ${errorMessage}\n\n_Please check the bot configuration or contact support._`,
          )
          .catch(() => {})

        if (repoRecord) {
          await saveFailedReview({
            db,
            repoId: repoRecord.id,
            provider: 'bitbucket',
            prNumber: prId,
            prTitle,
            prAuthor,
            reviewUrl: prUrl,
            errorMessage,
          })
        }
      }
      throw error
    }
  },
})

/**
 * Parse a unified diff string into a map of filename → patch.
 * Bitbucket's diff endpoint returns one big unified diff for all files.
 */
function parseDiffByFile(unifiedDiff: string): Map<string, string> {
  const result = new Map<string, string>()
  const fileSections = unifiedDiff.split(/^diff --git /m).filter(Boolean)

  for (const section of fileSections) {
    // Extract new filename from `+++ b/<path>` line
    const newFileMatch = section.match(/^\+\+\+ b\/(.+)$/m)
    if (!newFileMatch) continue
    const filename = newFileMatch[1].trim()
    // Keep everything from the first @@ hunk header onward
    const hunkStart = section.indexOf('@@ ')
    if (hunkStart === -1) continue
    result.set(filename, section.slice(hunkStart))
  }

  return result
}
