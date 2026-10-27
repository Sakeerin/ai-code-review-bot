import type { Context, Next } from 'hono'
import type { AppEnv } from './verify-signature.js'
import { z } from 'zod'
import postgres from 'postgres'

type Plan = 'free' | 'team' | 'business'
const PLAN_LIMITS: Record<Plan, number> = { free: 50, team: 500, business: Infinity }

const GitHubSchema = z.object({
  action: z.string(),
  installation: z.object({ id: z.number().int().positive() }),
  repository: z.object({ id: z.number().int().positive(), full_name: z.string() }),
  pull_request: z.object({
    number: z.number().int().positive(),
    head: z.object({ sha: z.string().min(1) }),
  }),
})
const GitLabSchema = z.object({
  object_attributes: z.object({
    action: z.string().optional(),
    iid: z.number().int().positive(),
    last_commit: z.object({ id: z.string().min(1) }),
  }),
  project: z.object({ id: z.number().int().positive(), path_with_namespace: z.string() }),
})
const BitbucketSchema = z.object({
  repository: z.object({ full_name: z.string().regex(/^[^/]+\/[^/]+$/) }),
  pullrequest: z.object({
    id: z.number().int().positive(),
    source: z.object({ commit: z.object({ hash: z.string().min(1) }) }),
  }),
})

export async function rateLimit(c: Context<AppEnv>, next: Next) {
  const provider = c.req.path.endsWith('/github')
    ? 'github'
    : c.req.path.endsWith('/gitlab')
      ? 'gitlab'
      : 'bitbucket'
  const event = c.req.header(
    provider === 'github'
      ? 'X-GitHub-Event'
      : provider === 'gitlab'
        ? 'X-Gitlab-Event'
        : 'X-Event-Key',
  )
  if (
    (provider === 'github' && event !== 'pull_request') ||
    (provider === 'gitlab' && event !== 'Merge Request Hook') ||
    (provider === 'bitbucket' &&
      !['pullrequest:created', 'pullrequest:updated'].includes(event ?? ''))
  )
    return next()

  let orgKey: string
  let externalRepoId: string
  let namespace: string
  let reviewNumber: number
  let headSha: string
  try {
    const payload: unknown = JSON.parse(c.get('rawBody'))
    if (provider === 'github') {
      const parsed = GitHubSchema.parse(payload)
      if (!['opened', 'synchronize', 'reopened'].includes(parsed.action)) return next()
      namespace = String(parsed.installation.id)
      orgKey = `gh:${namespace}`
      externalRepoId = String(parsed.repository.id)
      reviewNumber = parsed.pull_request.number
      headSha = parsed.pull_request.head.sha
    } else if (provider === 'gitlab') {
      const parsed = GitLabSchema.parse(payload)
      if (!['open', 'reopen', 'update'].includes(parsed.object_attributes.action ?? 'update'))
        return next()
      namespace = parsed.project.path_with_namespace.split('/')[0]
      if (!namespace) throw new Error('Missing namespace')
      orgKey = `gl:${namespace}`
      externalRepoId = String(parsed.project.id)
      reviewNumber = parsed.object_attributes.iid
      headSha = parsed.object_attributes.last_commit.id
    } else {
      const parsed = BitbucketSchema.parse(payload)
      namespace = parsed.repository.full_name.split('/')[0]
      orgKey = `bb:${namespace}`
      externalRepoId = parsed.repository.full_name
      reviewNumber = parsed.pullrequest.id
      headSha = parsed.pullrequest.source.commit.hash
    }
  } catch {
    return c.json({ error: 'Invalid webhook payload' }, 400)
  }

  const sql = postgres(c.env.DATABASE_URL, { max: 1 })
  const monthKey = new Date().toISOString().slice(0, 7)
  const reservationKey = JSON.stringify([orgKey, externalRepoId, reviewNumber, headSha])
  try {
    const outcome = await sql.begin(async (transaction) => {
      // postgres 3.4's Omit-based TransactionSql type drops its runtime call signature.
      const tx = transaction as unknown as typeof sql
      // Read the authoritative plan so billing changes apply immediately.
      const repoRows = await tx<{ plan: Plan | null; is_active: boolean | null }[]>`
      SELECT o.plan, r.is_active FROM repositories r
      JOIN organizations o ON o.id = r.org_id
      WHERE r.provider = ${provider} AND (
        (${provider} = 'github' AND r.github_repo_id = ${externalRepoId} AND o.github_installation_id = ${namespace}) OR
        (${provider} = 'gitlab' AND r.gitlab_project_id = ${externalRepoId}) OR
        (${provider} = 'bitbucket' AND r.bitbucket_repo_id = ${externalRepoId})
      ) LIMIT 1
    `
      if (repoRows[0]?.is_active === false) {
        return 'inactive' as const
      }
      let plan = repoRows[0]?.plan
      if (!plan) {
        const orgRows = await tx<{ plan: Plan | null }[]>`
        SELECT plan FROM organizations WHERE
          (${provider} = 'github' AND github_installation_id = ${namespace}) OR
          (${provider} = 'gitlab' AND gitlab_namespace = ${namespace}) OR
          (${provider} = 'bitbucket' AND bitbucket_workspace = ${namespace})
        LIMIT 1
      `
        plan = orgRows[0]?.plan ?? 'free'
      }
      const limit = PLAN_LIMITS[plan]
      await tx`
      INSERT INTO rate_limits (org_key, month_key, plan, used, overage_used, updated_at)
      VALUES (${orgKey}, ${monthKey}, ${plan}, 0, 0, NOW())
      ON CONFLICT (org_key, month_key) DO UPDATE SET plan = EXCLUDED.plan
    `
      const [counter] = await tx<{ used: number }[]>`
      SELECT used FROM rate_limits WHERE org_key = ${orgKey} AND month_key = ${monthKey} FOR UPDATE
    `
      const [existing] = await tx<{ status: string }[]>`
      SELECT status FROM review_reservations WHERE reservation_key = ${reservationKey}
    `
      if (existing?.status === 'reserved') return 'accepted' as const
      // Trigger retains terminal run idempotency keys. Redelivery must not reserve a
      // fresh slot for a completed/skipped/failed commit that it will not run again.
      if (existing) return 'finished' as const
      if (plan === 'free' && counter.used >= limit) return 'blocked' as const
      await tx`
      INSERT INTO review_reservations (reservation_key, org_key, month_key, status)
      VALUES (${reservationKey}, ${orgKey}, ${monthKey}, 'reserved')
      ON CONFLICT (reservation_key) DO NOTHING
    `
      await tx`
      UPDATE rate_limits SET used = used + 1,
        overage_used = CASE WHEN plan = 'team' THEN GREATEST(0, used + 1 - 500) ELSE 0 END,
        updated_at = NOW()
      WHERE org_key = ${orgKey} AND month_key = ${monthKey}
    `
      return 'accepted' as const
    })
    if (outcome === 'inactive')
      return c.json({ status: 'skipped', reason: 'Repository is inactive' })
    if (outcome === 'finished')
      return c.json({ status: 'skipped', reason: 'Commit already processed' })
    if (outcome === 'blocked') {
      return c.json({ error: 'Monthly quota reached', plan: 'free', limit: 50 }, 429)
    }
    c.set('reservationKey', reservationKey)
  } catch (error) {
    console.error('Rate-limit database query failed:', error)
    return c.json({ error: 'Unable to verify review quota. Please retry.' }, 503)
  } finally {
    await sql.end().catch(() => {})
  }
  return next()
}
