import { task } from '@trigger.dev/sdk/v3'
import { BitbucketClient } from '@repo/bitbucket'
import { createDb, repositories, organizations, eq } from '@repo/db'
import { parseReviewBotConfig, reviewDiff, getModifiedLines, ReviewError } from '@repo/ai'
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
  bitbucketUsername: string
  bitbucketAppPassword: string
}

const MAX_ATTEMPTS = 3

export const reviewBitbucketPRTask = task({
  id: 'review-bitbucket-pull-request',
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

    console.log(`[attempt ${ctx.attempt.number}] Starting Bitbucket review for ${repoFullName}#${prId}`)

    const db = createDb(undefined, 2)
    const bbClient = new BitbucketClient({
      username: bitbucketUsername,
      appPassword: bitbucketAppPassword,
    })

    try {
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
          if (config.ignore.some((ig) => f.newPath.includes(ig.replace(/\*/g, '')))) return false
          return true
        })
        .slice(0, config.limits.max_files_per_pr)

      if (reviewableFiles.length === 0) {
        return { success: true, message: 'No files to review.' }
      }

      const diffContent = reviewableFiles
        .map((f) => `File: ${f.newPath}\nDiff:\n${filePatchMap.get(f.newPath)}`)
        .join('\n\n')

      let reviewResult: Awaited<ReturnType<typeof reviewDiff>>
      try {
        reviewResult = await reviewDiff(diffContent, config)
      } catch (err) {
        if (err instanceof ReviewError && !err.retryable) {
          await bbClient.createPRComment(workspace, repoSlug, prId,
            `> **AI Review Bot** could not complete the review.\n> Reason: ${(err as Error).message}\n\n_This is a permanent error and will not be retried._`,
          ).catch(() => {})
          const repoRecord = await db.query.repositories
            .findFirst({ where: eq(repositories.fullName, repoFullName) })
            .catch(() => null)
          if (repoRecord) {
            await saveFailedReview({ db, repoId: repoRecord.id, provider: 'bitbucket', prNumber: prId, prTitle, prAuthor, reviewUrl: prUrl, errorMessage: (err as Error).message })
          }
          return { success: false, repoFullName, prId, message: (err as Error).message }
        }
        throw err
      }

      const persistedComments: PersistedComment[] = []
      let commentsPosted = 0
      let bugsFound = 0

      for (const comment of reviewResult.comments) {
        const file = reviewableFiles.find((f) => f.newPath === comment.file)
        if (!file) continue
        const patch = filePatchMap.get(file.newPath)
        if (!patch) continue
        if (!getModifiedLines(patch).includes(comment.line)) continue

        if (comment.severity === 'bug') bugsFound++

        const body = formatCommentBody(comment.severity, comment.message, comment.suggestion)
        try {
          await bbClient.createInlineComment(workspace, repoSlug, prId, body, comment.file, comment.line)
          commentsPosted++
          persistedComments.push({
            file: comment.file,
            line: comment.line,
            severity: comment.severity,
            message: comment.message,
            suggestion: comment.suggestion,
          })
        } catch (err) {
          console.warn(`Skipped Bitbucket inline comment for ${comment.file}:${comment.line}`, err)
        }
      }

      const summaryBody = `### AI Code Review Report\n**Score:** ${reviewResult.score}/100\n\n${reviewResult.summary}\n\n${commentsPosted > 0 ? `Posted ${commentsPosted} inline comment(s).` : '*No inline comments or suggestions.*'}`
      await bbClient.createPRComment(workspace, repoSlug, prId, summaryBody)

      // Upsert repo record
      let repoRecord = await db.query.repositories.findFirst({
        where: eq(repositories.fullName, repoFullName),
      })

      if (!repoRecord) {
        const orgName = workspace
        let org = await db.query.organizations.findFirst({ where: eq(organizations.name, orgName) })
        if (!org) {
          ;[org] = await db.insert(organizations).values({ name: orgName, plan: 'free' }).returning()
        }
        ;[repoRecord] = await db.insert(repositories).values({
          orgId: org.id,
          provider: 'bitbucket',
          bitbucketRepoId: repoFullName,
          fullName: repoFullName,
          webUrl: `https://bitbucket.org/${repoFullName}`,
          isActive: true,
        }).returning()
      }

      await saveReviewAndNotify(
        {
          db,
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
      console.error(`[attempt ${ctx.attempt.number}/${MAX_ATTEMPTS}] Bitbucket review failed for ${repoFullName}#${prId}:`, errorMessage)

      if (isLastAttempt) {
        await bbClient.createPRComment(workspace, repoSlug, prId,
          `> **AI Review Bot** failed to complete the review after ${MAX_ATTEMPTS} attempts.\n> Error: ${errorMessage}\n\n_Please check the bot configuration or contact support._`,
        ).catch(() => {})

        const repoRecord = await db.query.repositories
          .findFirst({ where: eq(repositories.fullName, repoFullName) })
          .catch(() => null)
        if (repoRecord) {
          await saveFailedReview({ db, repoId: repoRecord.id, provider: 'bitbucket', prNumber: prId, prTitle, prAuthor, reviewUrl: prUrl, errorMessage })
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
