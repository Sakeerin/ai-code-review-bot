import type { Context } from 'hono'
import type { AppEnv } from '../middleware/verify-signature.js'
import { tasks } from '@trigger.dev/sdk/v3'

/** PR actions we want to trigger a review for */
const REVIEWABLE_ACTIONS = ['opened', 'synchronize', 'reopened']

/**
 * Handle pull_request webhook events from GitHub.
 *
 * Triggers a review job for:
 * - PR opened
 * - New commits pushed to an open PR (synchronize)
 * - PR reopened
 */
export async function handlePullRequest(c: Context<AppEnv>): Promise<Response> {
  const rawBody = c.get('rawBody')
  const payload = JSON.parse(rawBody) as {
    action: string
    number: number
    pull_request: {
      number: number
      title: string
      user: { login: string }
      html_url: string
      additions: number
      deletions: number
      changed_files: number
    }
    repository: {
      id: number
      full_name: string
    }
    installation?: { id: number }
  }

  const { action, pull_request: pr, repository, installation } = payload

  console.log(
    `📨 PR event: ${action} — ${repository.full_name}#${pr.number} "${pr.title}"`,
  )

  // Only review on specific actions
  if (!REVIEWABLE_ACTIONS.includes(action)) {
    console.log(`⏭️ Skipping action: ${action}`)
    return c.json({
      status: 'skipped',
      reason: `Action "${action}" is not reviewable`,
    })
  }

  // Must have installation ID to authenticate as the app
  if (!installation?.id) {
    console.error('❌ Missing installation ID in webhook payload')
    return c.json({ error: 'Missing installation ID' }, 400)
  }

  // ── Dispatch background job ──────────────────────────────────
  const jobPayload = {
    installationId: installation.id,
    repoFullName: repository.full_name,
    prNumber: pr.number,
    prTitle: pr.title,
    prAuthor: pr.user.login,
  }

  console.log('🚀 Dispatching review job:', JSON.stringify(jobPayload))

  // Dispatch Trigger.dev task
  await tasks.trigger('review-pull-request', jobPayload)

  return c.json({
    status: 'accepted',
    message: `Review job dispatched for ${repository.full_name}#${pr.number}`,
    job: jobPayload,
  })
}
