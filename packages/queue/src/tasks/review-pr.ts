import { task } from '@trigger.dev/sdk/v3'
import { createInstallationOctokit, GitHubClient } from '@repo/github'
import { createDb, reviews, repositories } from '@repo/db'
import { eq } from 'drizzle-orm'

/** Payload type for the PR review task */
export interface ReviewPRPayload {
  installationId: number
  repoFullName: string
  prNumber: number
  prTitle: string
  prAuthor: string
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
    try {
      const files = await githubClient.getPullRequestFiles(owner, repo, prNumber)
      console.log(`   Found ${files.length} changed files`)
      const diffStr = await githubClient.getPullRequestDiff(owner, repo, prNumber)
      console.log(`   Diff size: ${diffStr.length} lines/characters (approx)`)
    } catch (error) {
      console.error(`❌ Failed to fetch diff:`, error)
      throw error // Retry task if GitHub api fails
    }

    // ── Step 2: Load convention profile ────────────────────────
    console.log('📋 Loading convention profile...')

    // ── Step 3: Run AI review ──────────────────────────────────
    console.log('🤖 AI review not yet implemented (Phase 2)')

    // ── Step 4: Post comments on GitHub ────────────────────────
    console.log('💬 Comment posting not yet implemented')

    // ── Step 5: Save review to DB ──────────────────────────────
    console.log('💾 DB save not yet implemented fully...')
    
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
          tokensInput: 0,
          tokensOutput: 0,
          commentsPosted: 0,
          completedAt: new Date(),
        })
        console.log('💾 Review saved to DB')
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
      message: 'Phase 1: Task executed successfully (no AI review yet)',
    }
  },
})
