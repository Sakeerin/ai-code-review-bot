import type { Context, Next } from 'hono'
import type { AppEnv } from './verify-signature.js'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '@repo/db/schema'
import { eq } from 'drizzle-orm'

/**
 * Rate limiting middleware using Cloudflare Workers KV.
 *
 * Limits are based on the organization's plan:
 * - Free: 50 PRs/month
 * - Team: 500 PRs/month
 * - Business: Unlimited
 */
export async function rateLimit(c: Context<AppEnv>, next: Next) {
  const event = c.req.header('X-GitHub-Event') || c.req.header('X-Gitlab-Event')
  const isGitHub = !!c.req.header('X-GitHub-Event')
  
  // Only rate limit reviewable actions
  if (event !== 'pull_request' && event !== 'Merge Request Hook') {
    return next()
  }

  const rawBody = c.get('rawBody')
  if (!rawBody) return next()

  const payload = JSON.parse(rawBody)
  let orgId: string | undefined

  if (isGitHub) {
    const action = payload.action
    if (!['opened', 'synchronize', 'reopened'].includes(action)) return next()
    orgId = payload.installation?.id?.toString()
  } else {
    const action = payload.object_attributes?.action ?? 'update'
    if (!['open', 'reopen', 'update'].includes(action)) return next()
    // For GitLab, we use the root namespace as the org identifier
    orgId = payload.group?.path ?? payload.project_namespace ?? payload.project?.path_with_namespace?.split('/')[0]
  }

  if (!orgId) {
    console.warn('⚠️ Could not determine orgId for rate limiting')
    return next()
  }

  const kvKey = `rate_limit:${isGitHub ? 'gh' : 'gl'}:${orgId}`
  const monthKey = new Date().toISOString().slice(0, 7) // YYYY-MM
  const fullKey = `${kvKey}:${monthKey}`

  // 1. Check KV
  let data = await c.env.RATE_LIMIT_KV.get<{
    limit: number
    used: number
    plan: string
  }>(fullKey, 'json')

  // 2. If not in KV, fetch from DB and initialize
  if (!data) {
    console.log(`ℹ️ Rate limit data not in KV for ${fullKey}, fetching from DB...`)
    const sql = postgres(c.env.DATABASE_URL)
    const db = drizzle(sql, { schema })

    let plan: 'free' | 'team' | 'business' = 'free'

    if (isGitHub) {
      const org = await db.query.organizations.findFirst({
        where: eq(schema.organizations.githubInstallationId, orgId),
      })
      plan = org?.plan || 'free'
    } else {
      // For GitLab, we might need a different way to find the org
      // For now, let's assume we can find it by name or a specific gitlab field if we add it
      // Since the schema only has githubInstallationId, let's look for a repo first
      const repo = await db.query.repositories.findFirst({
        where: eq(schema.repositories.fullName, payload.project?.path_with_namespace),
        with: { organization: true }
      })
      plan = (repo?.organization?.plan as any) || 'free'
    }

    const limits = {
      free: 50,
      team: 500,
      business: 10000, // Effectively unlimited
    }

    data = {
      limit: limits[plan],
      used: 0,
      plan,
    }

    // Cache in KV for 30 days
    await c.env.RATE_LIMIT_KV.put(fullKey, JSON.stringify(data), {
      expirationTtl: 60 * 60 * 24 * 30,
    })
  }

  // 3. Check if limit reached
  if (data.used >= data.limit) {
    console.warn(`🛑 Rate limit reached for ${fullKey}: ${data.used}/${data.limit}`)
    return c.json({
      error: 'Rate limit reached',
      message: `You have reached your monthly limit of ${data.limit} reviews for the ${data.plan} plan. Please upgrade to continue.`,
    }, 429)
  }

  // 4. Increment usage
  data.used += 1
  await c.env.RATE_LIMIT_KV.put(fullKey, JSON.stringify(data), {
    expirationTtl: 60 * 60 * 24 * 30,
  })

  console.log(`✅ Rate limit check passed for ${fullKey}: ${data.used}/${data.limit}`)
  
  return next()
}
