import { task } from '@trigger.dev/sdk/v3'
import { createInstallationOctokit, GitHubClient } from '@repo/github'
import { createDb, reviews, repositories, organizations, eq } from '@repo/db'
import { parseReviewBotConfig, reviewDiff, getModifiedLines } from '@repo/ai'
import { reportPRReviewToMeter } from '../lib/stripe-meter.js'

/** Payload type for the PR review task */
export interface ReviewPRPayload {
  installationId: number
  repoFullName: string
  prNumber: number
  prTitle: string
  prAuthor: string
  headSha: string
}

/**
 * Background task to review a pull request.
 *
 * Flow:
 * 1. Fetch PR diff from GitHub API
 * 2. Load convention profile from DB / repo config
 * 3. Run Claude review (Phase 2)
 * 4. Post inline comments on GitHub
 * 5. Save review record to DB
 */
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

    console.log(`🔍 Starting review for ${repoFullName}#${prNumber}`)
    console.log(`   Title: ${prTitle}`)
    console.log(`   Author: ${prAuthor}`)
    console.log(`   Installation: ${installationId}`)

    // Initialize clients
    const githubAppConfig = {
      appId: process.env.GITHUB_APP_ID!,
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
      webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
    }
    const octokit = await createInstallationOctokit(githubAppConfig, installationId)
    const githubClient = new GitHubClient(octokit)
    const db = createDb()

    // ── Step 1: Fetch PR diff ──────────────────────────────────
    console.log(`📥 Fetching diff for ${owner}/${repo}#${prNumber}...`)
    let files: ReturnType<typeof githubClient.getPullRequestFiles> extends Promise<infer U> ? U : any
    try {
      files = await githubClient.getPullRequestFiles(owner, repo, prNumber)
      console.log(`   Found ${files.length} changed files`)
      const diffStr = await githubClient.getPullRequestDiff(owner, repo, prNumber)
      console.log(`   Diff size: ${diffStr.length} lines/characters (approx)`)
    } catch (error) {
      console.error(`❌ Failed to fetch diff:`, error)
      throw error // Retry task if GitHub api fails
    }

    // ── Step 2: Load convention profile ────────────────────────
    console.log('📋 Loading convention profile...')
    const configYml = await githubClient.getFileContent(
      owner,
      repo,
      '.reviewbot.yml',
      payload.headSha,
    )
    const config = parseReviewBotConfig(configYml)

    // Apply strict filtering
    const reviewableFiles = files.filter((f) => {
      if (f.status === 'removed') return false
      if (f.additions + f.deletions > config.limits.max_file_size_lines) return false
      if (config.ignore.some(ig => f.filename.includes(ig.replace(/\*/g, '')))) return false
      return !!f.patch
    }).slice(0, config.limits.max_files_per_pr)

    if (reviewableFiles.length === 0) {
      console.log('⏭️ No reviewable files found based on limits/status.')
      return { success: true, message: 'No files to review.' }
    }

    // ── Step 3: Run AI review ──────────────────────────────────
    console.log('🤖 Running AI review...')
    const diffContent = reviewableFiles
      .map((f) => `File: ${f.filename}\nDiff:\n${f.patch}`)
      .join('\n\n')

    const reviewResult = await reviewDiff(diffContent, config)
    console.log(`   Tokens used: ${reviewResult.tokensUsed}`)
    console.log(`   Score: ${reviewResult.score}`)

    // ── Step 4: Post comments on GitHub ────────────────────────
    console.log('💬 Validating and posting comments...')
    const validComments = []
    let bugsFound = 0

    for (const comment of reviewResult.comments) {
      const file = reviewableFiles.find(f => f.filename === comment.file)
      if (!file || !file.patch) continue

      const modifiedLines = getModifiedLines(file.patch)
      
      if (modifiedLines.includes(comment.line)) {
        if (comment.severity === 'bug') bugsFound++

        let body = `**[${comment.severity.toUpperCase()}]** ${comment.message}`
        if (comment.suggestion) {
          body += `\n\n\`\`\`suggestion\n${comment.suggestion}\n\`\`\``
        }

        validComments.push({
          path: comment.file,
          line: comment.line,
          side: 'RIGHT' as const,
          body,
        })
      } else {
        console.log(`⚠️ Skipped invalid comment for ${comment.file}:${comment.line}`)
      }
    }

    if (validComments.length > 0) {
      const summary = `### AI Code Review Report\n**Score:** ${reviewResult.score}/100\n\n${reviewResult.summary}`
      await githubClient.createReview(owner, repo, prNumber, summary, 'COMMENT', validComments)
      console.log(`   Posted ${validComments.length} inline comments.`)
    } else {
      await githubClient.createPRComment(owner, repo, prNumber, `### AI Code Review Report\n**Score:** ${reviewResult.score}/100\n\n${reviewResult.summary}\n\n*No inline comments or suggestions.*`)
      console.log('   Posted summary comment only.')
    }

    // ── Step 5: Save review to DB ──────────────────────────────
    console.log('💾 Saving review to DB...')
    
    // We should ideally sync the repo and org to the DB first, but for now we look up repo
    // If we don't have the repo, Phase 1 doesn't enforce strict DB saving since webhooks handle sync
    try {
      const repoRecords = await db
        .select()
        .from(repositories)
        // @ts-ignore
        .where(eq(repositories.fullName, repoFullName))
        .limit(1)
        
      const repoRecord = repoRecords[0]
      
      if (repoRecord) {
        await db.insert(reviews).values({
          repoId: repoRecord.id,
          prNumber,
          prTitle,
          prAuthor,
          status: 'completed',
          tokensInput: reviewResult.tokensUsed,
          tokensOutput: 0,
          commentsPosted: validComments.length,
          bugsFound,
          score: reviewResult.score,
          completedAt: new Date(),
        })
        console.log('💾 Review saved to DB')

        // ── Stripe Billing Meter ────────────────────────────────
        const orgRecord = await db
          .select({ stripeCustomerId: organizations.stripeCustomerId })
          .from(organizations)
          .where(eq(organizations.id, repoRecord.orgId))
          .limit(1)
          .then((rows) => rows[0])

        await reportPRReviewToMeter(orgRecord?.stripeCustomerId ?? null)
      } else {
        console.log(`⚠️ Repo ${repoFullName} not found in DB. Skipping review record insert.`)
      }
    } catch (e) {
      console.error('Failed to save review to DB:', e)
    }

    console.log(`✅ Review task completed for ${repoFullName}#${prNumber}`)

    return {
      success: true,
      repoFullName,
      prNumber,
      message: 'Phase 2: AI Review executed successfully',
    }
  },
})
