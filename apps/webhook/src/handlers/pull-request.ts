import type { Context } from 'hono'
import type { AppEnv } from '../middleware/verify-signature.js'
import { tasks } from '@trigger.dev/sdk/v3'
import { z } from 'zod'

/** PR actions we want to trigger a review for */
const REVIEWABLE_ACTIONS = ['opened', 'synchronize', 'reopened']

const PullRequestPayloadSchema = z.object({
  action: z.string(),
  pull_request: z.object({
    number: z.number(),
    title: z.string(),
    user: z.object({ login: z.string() }),
    head: z.object({ sha: z.string(), ref: z.string() }),
  }),
  repository: z.object({
    id: z.number(),
    full_name: z.string(),
  }),
  installation: z.object({ id: z.number() }).optional(),
})

export async function handlePullRequest(c: Context<AppEnv>): Promise<Response> {
  const rawBody = c.get('rawBody')

  const parsed = PullRequestPayloadSchema.safeParse(JSON.parse(rawBody))
  if (!parsed.success) {
    console.error('❌ Invalid pull_request payload:', parsed.error.flatten())
    return c.json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400)
  }
  const payload = parsed.data

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
    headSha: pr.head.sha,
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
