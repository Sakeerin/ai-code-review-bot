import { task } from '@trigger.dev/sdk/v3'
import { createInstallationOctokit, GitHubClient } from '@repo/github'
import { createDb, repositories, eq } from '@repo/db'
import { parseReviewBotConfig, reviewDiff, getModifiedLines } from '@repo/ai'
import { saveReviewAndNotify, formatCommentBody, type PersistedComment } from '../lib/save-review.js'

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

    const files = await githubClient.getPullRequestFiles(owner, repo, prNumber)
    const configYml = await githubClient.getFileContent(owner, repo, '.reviewbot.yml', payload.headSha)
    const config = parseReviewBotConfig(configYml)

    // Filter reviewable files — skip removed, binary, ignored, and oversized files
    const reviewableFiles = files
      .filter((file) => {
        if (file.status === 'removed') return false
        if (!file.patch) return false
        // Use actual modified-line count, not additions+deletions (which double-counts)
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

    const reviewResult = await reviewDiff(diffContent, config)

    // Validate each comment against actual modified lines and build payloads
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
    const reviewUrl = `https://github.com/${repoFullName}/pull/${prNumber}`

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
  },
})
