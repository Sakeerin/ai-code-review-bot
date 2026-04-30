import { task } from '@trigger.dev/sdk/v3'
import { GitLabClient } from '@repo/gitlab'
import type { GitLabMergeRequestChange } from '@repo/gitlab'
import { createDb } from '@repo/db'
import { parseReviewBotConfig, reviewDiff, getModifiedLines, ReviewError } from '@repo/ai'
import {
  saveReviewAndNotify,
  saveFailedReview,
  upsertGitLabRepo,
  formatCommentBody,
  type PersistedComment,
} from '../lib/save-review.js'

export interface ReviewMergeRequestPayload {
  projectId: number
  projectPath: string
  projectWebUrl?: string
  mergeRequestIid: number
  mergeRequestTitle: string
  mergeRequestAuthor: string
  rootNamespace?: string
}

const MAX_ATTEMPTS = 3

export const reviewMergeRequestTask = task({
  id: 'review-merge-request',
  retry: {
    maxAttempts: MAX_ATTEMPTS,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 30000,
  },
  run: async (payload: ReviewMergeRequestPayload, { ctx }) => {
    const { projectId, projectPath, mergeRequestIid, mergeRequestTitle, mergeRequestAuthor } = payload
    const isLastAttempt = ctx.attempt.number >= MAX_ATTEMPTS
    const reviewUrl = payload.projectWebUrl
      ? `${payload.projectWebUrl}/-/merge_requests/${mergeRequestIid}`
      : `https://gitlab.com/${projectPath}/-/merge_requests/${mergeRequestIid}`

    console.log(`[attempt ${ctx.attempt.number}] Starting review for ${projectPath}!${mergeRequestIid}`)

    const db = createDb(undefined, 2)
    const gitlabClient = new GitLabClient({
      baseUrl: process.env.GITLAB_API_URL ?? 'https://gitlab.com/api/v4',
      token: process.env.GITLAB_TOKEN!,
    })

    try {
      const mergeRequest = await gitlabClient.getMergeRequest(projectId, mergeRequestIid)
      const changes = await gitlabClient.getMergeRequestChanges(projectId, mergeRequestIid)
      const configYml = await gitlabClient.getFileContent(
        projectId,
        '.reviewbot.yml',
        mergeRequest.diffRefs.headSha,
      )
      const config = parseReviewBotConfig(configYml)

      const reviewableFiles = (changes as GitLabMergeRequestChange[])
        .filter((file) => {
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
        .map((file) => `File: ${file.newPath}\nDiff:\n${file.diff}`)
        .join('\n\n')

      let reviewResult: Awaited<ReturnType<typeof reviewDiff>>
      try {
        reviewResult = await reviewDiff(diffContent, config)
      } catch (err) {
        if (err instanceof ReviewError && !err.retryable) {
          console.error(`Non-retryable Claude error for ${projectPath}!${mergeRequestIid}:`, err.message)
          await gitlabClient.createMergeRequestNote(
            projectId,
            mergeRequestIid,
            `> **AI Review Bot** could not complete the review.\n> Reason: ${err.message}\n\n_This is a permanent error and will not be retried._`,
          ).catch(() => {})
          const repoRecord = await upsertGitLabRepo(db, {
            projectId, projectPath, projectWebUrl: payload.projectWebUrl, rootNamespace: payload.rootNamespace,
          }).catch(() => null)
          if (repoRecord) {
            await saveFailedReview({
              db, repoId: repoRecord.id, provider: 'gitlab',
              prNumber: mergeRequestIid, prTitle: mergeRequestTitle, prAuthor: mergeRequestAuthor,
              reviewUrl, errorMessage: err.message,
            })
          }
          return { success: false, projectPath, mergeRequestIid, message: err.message }
        }
        throw err // Retryable — let Trigger.dev retry with backoff
      }

      const persistedComments: PersistedComment[] = []
      let commentsPosted = 0
      let bugsFound = 0

      for (const comment of reviewResult.comments) {
        const file = reviewableFiles.find((f) => f.newPath === comment.file)
        if (!file?.diff) continue
        if (!getModifiedLines(file.diff).includes(comment.line)) continue

        if (comment.severity === 'bug') bugsFound++

        const body = formatCommentBody(comment.severity, comment.message, comment.suggestion)

        try {
          await gitlabClient.createInlineDiscussion(projectId, mergeRequestIid, {
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
        projectId,
        mergeRequestIid,
        `### AI Code Review Report\n**Score:** ${reviewResult.score}/100\n\n${reviewResult.summary}\n\n${
          commentsPosted > 0
            ? `Posted ${commentsPosted} inline comments.`
            : '*No inline comments or suggestions.*'
        }`,
      )

      const repoRecord = await upsertGitLabRepo(db, {
        projectId, projectPath, projectWebUrl: payload.projectWebUrl, rootNamespace: payload.rootNamespace,
      })

      await saveReviewAndNotify(
        {
          db,
          repoId: repoRecord.id,
          provider: 'gitlab',
          prNumber: mergeRequestIid,
          prTitle: mergeRequestTitle,
          prAuthor: mergeRequestAuthor,
          reviewUrl: mergeRequest.webUrl,
          reviewResult,
          persistedComments,
          commentsPosted,
          bugsFound,
          orgId: repoRecord.orgId,
        },
        {
          provider: 'gitlab',
          repository: projectPath,
          reviewNumber: mergeRequestIid,
          title: mergeRequestTitle,
          author: mergeRequestAuthor,
          reviewUrl: mergeRequest.webUrl,
        },
      )

      return {
        success: true,
        projectPath,
        mergeRequestIid,
        message: 'GitLab merge request reviewed successfully',
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(
        `[attempt ${ctx.attempt.number}/${MAX_ATTEMPTS}] Review failed for ${projectPath}!${mergeRequestIid}:`,
        errorMessage,
      )

      if (isLastAttempt) {
        await gitlabClient.createMergeRequestNote(
          projectId,
          mergeRequestIid,
          `> **AI Review Bot** failed to complete the review after ${MAX_ATTEMPTS} attempts.\n> Error: ${errorMessage}\n\n_Please check the bot configuration or contact support._`,
        ).catch(() => {})

        const repoRecord = await upsertGitLabRepo(db, {
          projectId, projectPath, projectWebUrl: payload.projectWebUrl, rootNamespace: payload.rootNamespace,
        }).catch(() => null)

        if (repoRecord) {
          await saveFailedReview({
            db, repoId: repoRecord.id, provider: 'gitlab',
            prNumber: mergeRequestIid, prTitle: mergeRequestTitle, prAuthor: mergeRequestAuthor,
            reviewUrl, errorMessage,
          })
        }
      }

      throw error // Always re-throw so Trigger.dev tracks the failure
    }
  },
})
