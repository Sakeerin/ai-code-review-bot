import { task } from '@trigger.dev/sdk/v3'
import { GitLabClient } from '@repo/gitlab'
import type { GitLabMergeRequestChange } from '@repo/gitlab'
import { createDb } from '@repo/db'
import { parseReviewBotConfig, reviewDiff, getModifiedLines } from '@repo/ai'
import {
  saveReviewAndNotify,
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

export const reviewMergeRequestTask = task({
  id: 'review-merge-request',
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 30000,
  },
  run: async (payload: ReviewMergeRequestPayload) => {
    const db = createDb(undefined, 2)
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

    // Filter reviewable files — skip deleted, binary, ignored, and oversized files
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

    const reviewResult = await reviewDiff(diffContent, config)

    // Post each inline comment individually (GitLab API requirement)
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
      `### AI Code Review Report\n**Score:** ${reviewResult.score}/100\n\n${reviewResult.summary}\n\n${
        commentsPosted > 0
          ? `Posted ${commentsPosted} inline comments.`
          : '*No inline comments or suggestions.*'
      }`,
    )

    const repoRecord = await upsertGitLabRepo(db, {
      projectId: payload.projectId,
      projectPath: payload.projectPath,
      projectWebUrl: payload.projectWebUrl,
      rootNamespace: payload.rootNamespace,
    })

    await saveReviewAndNotify(
      {
        db,
        repoId: repoRecord.id,
        provider: 'gitlab',
        prNumber: payload.mergeRequestIid,
        prTitle: payload.mergeRequestTitle,
        prAuthor: payload.mergeRequestAuthor,
        reviewUrl: mergeRequest.webUrl,
        reviewResult,
        persistedComments,
        commentsPosted,
        bugsFound,
        orgId: repoRecord.orgId,
      },
      {
        provider: 'gitlab',
        repository: payload.projectPath,
        reviewNumber: payload.mergeRequestIid,
        title: payload.mergeRequestTitle,
        author: payload.mergeRequestAuthor,
        reviewUrl: mergeRequest.webUrl,
      },
    )

    return {
      success: true,
      projectPath: payload.projectPath,
      mergeRequestIid: payload.mergeRequestIid,
      message: 'GitLab merge request reviewed successfully',
    }
  },
})
