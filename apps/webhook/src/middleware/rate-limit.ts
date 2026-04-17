import type { Context, Next } from 'hono'
import type { AppEnv } from './verify-signature.js'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '@repo/db/schema'
import { eq } from 'drizzle-orm'

interface RateLimitData {
  limit: number
  used: number
  overageUsed: number
  plan: 'free' | 'team' | 'business'
}

const PLAN_LIMITS: Record<'free' | 'team' | 'business', number> = {
  free:     50,
  team:     500,
  business: Infinity,
}

/**
 * Rate limiting middleware using Cloudflare Workers KV.
 *
 * - Free: hard block at 50 PRs/month (return 429)
 * - Team: allow up to 500 PRs, then continue with overage tracking ($0.05/PR)
 * - Business: always pass through (unlimited)
 *
 * Overage is tracked in KV and reported to Stripe Billing Meter by the
 * queue task that processes the review.
 */
export async function rateLimit(c: Context<AppEnv>, next: Next) {
  const event = c.req.header('X-GitHub-Event') || c.req.header('X-Gitlab-Event')
  const isGitHub = !!c.req.header('X-GitHub-Event')

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
    orgId = payload.group?.path
      ?? payload.project_namespace
      ?? payload.project?.path_with_namespace?.split('/')[0]
  }

  if (!orgId) {
    console.warn('⚠️ Could not determine orgId for rate limiting, allowing through')
    return next()
  }

  const monthKey = new Date().toISOString().slice(0, 7)
  const kvKey = `rl:${isGitHub ? 'gh' : 'gl'}:${orgId}:${monthKey}`

  // ── 1. Load or initialize KV state ────────────────────────────
  let data = await c.env.RATE_LIMIT_KV.get<RateLimitData>(kvKey, 'json')

  if (!data) {
    const plan = await fetchPlan(c.env.DATABASE_URL, isGitHub, orgId, payload)
    data = { limit: PLAN_LIMITS[plan], used: 0, overageUsed: 0, plan }
  }

  // ── 2. Business plan: always pass through ─────────────────────
  if (data.plan === 'business' || data.limit === Infinity) {
    data.used += 1
    await saveKv(c.env.RATE_LIMIT_KV, kvKey, data)
    return next()
  }

  // ── 3. Free plan: hard block once quota is exhausted ──────────
  if (data.plan === 'free' && data.used >= data.limit) {
    console.warn(`🛑 Free plan quota exhausted for ${kvKey}: ${data.used}/${data.limit}`)
    return c.json({
      error: 'Monthly quota reached',
      plan: 'free',
      limit: data.limit,
      message: `You've used all ${data.limit} free PR reviews this month. Upgrade at https://reviewbot.app/pricing to continue.`,
    }, 429)
  }

  // ── 4. Team plan: allow with overage tracking after 500 ───────
  data.used += 1

  if (data.used > data.limit) {
    data.overageUsed += 1
    console.log(`💳 Overage: ${kvKey} — ${data.overageUsed} PRs over quota (total: ${data.used})`)
  } else {
    console.log(`✅ Rate limit: ${kvKey} — ${data.used}/${data.limit}`)
  }

  await saveKv(c.env.RATE_LIMIT_KV, kvKey, data)
  return next()
}

// ─── Helpers ─────────────────────────────────────────────────────

async function fetchPlan(
  databaseUrl: string,
  isGitHub: boolean,
  orgId: string,
  payload: Record<string, unknown>,
): Promise<'free' | 'team' | 'business'> {
  try {
    const sql = postgres(databaseUrl)
    const db = drizzle(sql, { schema })

    if (isGitHub) {
      const org = await db.query.organizations.findFirst({
        where: eq(schema.organizations.githubInstallationId, orgId),
      })
      return (org?.plan as 'free' | 'team' | 'business') || 'free'
    }

    const repoFullName = (payload as { project?: { path_with_namespace?: string } })
      .project?.path_with_namespace
    if (repoFullName) {
      const repo = await db.query.repositories.findFirst({
        where: eq(schema.repositories.fullName, repoFullName),
        with: { organization: true },
      })
      return (repo?.organization?.plan as 'free' | 'team' | 'business') || 'free'
    }
  } catch (err) {
    console.error('⚠️ Could not fetch plan from DB, defaulting to free:', err)
  }
  return 'free'
}

async function saveKv(
  kv: KVNamespace,
  key: string,
  data: RateLimitData,
) {
  await kv.put(key, JSON.stringify(data), {
    expirationTtl: 60 * 60 * 24 * 32, // 32 days
  })
}
