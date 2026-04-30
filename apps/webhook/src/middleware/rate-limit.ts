import type { Context, Next } from 'hono'
import type { AppEnv } from './verify-signature.js'
import { z } from 'zod'
import postgres from 'postgres'

// ─── Payload schemas (minimal — only fields we actually use) ──────

const GitHubRateLimitSchema = z.object({
  action: z.string(),
  installation: z.object({ id: z.union([z.number(), z.string()]) }).optional(),
})

const GitLabRateLimitSchema = z.object({
  object_attributes: z.object({ action: z.string().optional() }).optional(),
  group: z.object({ path: z.string().optional() }).optional(),
  project_namespace: z.string().optional(),
  project: z.object({
    path_with_namespace: z.string().optional(),
  }).optional(),
})

// ─── Plan limits ──────────────────────────────────────────────────

type Plan = 'free' | 'team' | 'business'

const PLAN_LIMITS: Record<Plan, number> = {
  free:     50,
  team:     500,
  business: Infinity,
}

/**
 * Rate limiting middleware using atomic DB counters.
 *
 * Uses INSERT ... ON CONFLICT DO UPDATE to atomically increment the
 * per-org monthly counter, eliminating the KV read-increment-write
 * race condition. KV is kept only for plan caching.
 *
 * - Free:     hard block at 50 PRs/month (return 429)
 * - Team:     allow up to 500 PRs, then track overage ($0.05/PR)
 * - Business: always pass through (unlimited)
 */
export async function rateLimit(c: Context<AppEnv>, next: Next) {
  const event = c.req.header('X-GitHub-Event') || c.req.header('X-Gitlab-Event')
  const isGitHub = !!c.req.header('X-GitHub-Event')

  if (event !== 'pull_request' && event !== 'Merge Request Hook') {
    return next()
  }

  const rawBody = c.get('rawBody')
  if (!rawBody) return next()

  let rawPayload: unknown
  try {
    rawPayload = JSON.parse(rawBody)
  } catch {
    return c.json({ error: 'Invalid JSON payload' }, 400)
  }

  // ── 1. Validate payload and extract orgKey ─────────────────────
  let orgKey: string | undefined

  if (isGitHub) {
    const parsed = GitHubRateLimitSchema.safeParse(rawPayload)
    if (!parsed.success) {
      return c.json({ error: 'Invalid GitHub payload', details: parsed.error.flatten() }, 400)
    }
    const { action, installation } = parsed.data
    if (!['opened', 'synchronize', 'reopened'].includes(action)) return next()
    if (!installation?.id) {
      console.error('❌ Missing installation.id in GitHub rate-limit check')
      return c.json({ error: 'Missing installation ID' }, 400)
    }
    orgKey = `gh:${installation.id}`
  } else {
    const parsed = GitLabRateLimitSchema.safeParse(rawPayload)
    if (!parsed.success) {
      return c.json({ error: 'Invalid GitLab payload', details: parsed.error.flatten() }, 400)
    }
    const { object_attributes, group, project_namespace, project } = parsed.data
    const action = object_attributes?.action ?? 'update'
    if (!['open', 'reopen', 'update'].includes(action)) return next()

    const namespace =
      group?.path ??
      project_namespace ??
      project?.path_with_namespace?.split('/')[0]

    if (!namespace) {
      console.error('❌ Cannot determine GitLab namespace for rate limiting — rejecting')
      return c.json({ error: 'Cannot determine organization for rate limiting' }, 400)
    }
    orgKey = `gl:${namespace}`
  }

  // ── 2. Atomic increment via DB (eliminates race condition) ──────
  const monthKey = new Date().toISOString().slice(0, 7)

  let result: { used: number; overage_used: number; plan: Plan }

  try {
    const sql = postgres(c.env.DATABASE_URL, { max: 1 })

    // Fetch plan: KV cache first (1h TTL), fallback to DB query
    const planCacheKey = `plan:${orgKey}`
    const cachedPlan = await c.env.RATE_LIMIT_KV.get<Plan>(planCacheKey, 'json')
    const plan = cachedPlan ?? await fetchPlan(sql, isGitHub, orgKey, rawPayload as Record<string, unknown>)

    if (!cachedPlan) {
      // Fire-and-forget: don't block the request on cache write
      c.env.RATE_LIMIT_KV.put(planCacheKey, JSON.stringify(plan), { expirationTtl: 3600 })
        .catch(() => {/* non-fatal */})
    }

    const limit = PLAN_LIMITS[plan]

    // Atomic upsert: increment used (and overage_used if past limit)
    const rows = await sql<{ used: number; overage_used: number; plan: Plan }[]>`
      INSERT INTO rate_limits (org_key, month_key, plan, used, overage_used, updated_at)
      VALUES (${orgKey}, ${monthKey}, ${plan}, 1, 0, NOW())
      ON CONFLICT (org_key, month_key) DO UPDATE
        SET
          used         = rate_limits.used + 1,
          overage_used = CASE
            WHEN rate_limits.used + 1 > ${limit === Infinity ? 999999999 : limit}
            THEN rate_limits.overage_used + 1
            ELSE rate_limits.overage_used
          END,
          updated_at   = NOW()
      RETURNING used, overage_used, plan
    `

    await sql.end()
    result = rows[0]
  } catch (err) {
    // DB unavailable — fail open with a warning to avoid blocking all reviews
    console.error('⚠️ Rate-limit DB query failed, allowing through:', err)
    return next()
  }

  const { used, overage_used, plan } = result
  const limit = PLAN_LIMITS[plan]

  // ── 3. Business plan: always pass through ─────────────────────
  if (plan === 'business' || limit === Infinity) {
    return next()
  }

  // ── 4. Free plan: hard block once quota is exhausted ──────────
  if (plan === 'free' && used > limit) {
    console.warn(`🛑 Free plan quota exhausted for ${orgKey}: ${used}/${limit}`)
    return c.json({
      error: 'Monthly quota reached',
      plan: 'free',
      limit,
      message: `You've used all ${limit} free PR reviews this month. Upgrade at https://reviewbot.app/pricing to continue.`,
    }, 429)
  }

  // ── 5. Team plan: allow with overage tracking after 500 ───────
  if (overage_used > 0) {
    console.log(`💳 Overage: ${orgKey} — ${overage_used} PRs over quota (total: ${used})`)
  } else {
    console.log(`✅ Rate limit: ${orgKey} — ${used}/${limit}`)
  }

  return next()
}

// ─── Helpers ──────────────────────────────────────────────────────

async function fetchPlan(
  sql: ReturnType<typeof postgres>,
  isGitHub: boolean,
  orgKey: string,
  payload: Record<string, unknown>,
): Promise<Plan> {
  try {
    if (isGitHub) {
      const installationId = orgKey.replace('gh:', '')
      const rows = await sql<{ plan: Plan }[]>`
        SELECT plan FROM organizations
        WHERE github_installation_id = ${installationId}
        LIMIT 1
      `
      return rows[0]?.plan ?? 'free'
    }

    const namespace = orgKey.replace('gl:', '')
    const projectPath = (payload as { project?: { path_with_namespace?: string } })
      .project?.path_with_namespace

    if (projectPath) {
      const rows = await sql<{ plan: Plan }[]>`
        SELECT o.plan FROM organizations o
        INNER JOIN repositories r ON r.org_id = o.id
        WHERE r.full_name = ${projectPath}
        LIMIT 1
      `
      if (rows[0]) return rows[0].plan
    }

    // Fallback: match by org name / namespace
    const rows = await sql<{ plan: Plan }[]>`
      SELECT plan FROM organizations
      WHERE name = ${namespace}
      LIMIT 1
    `
    return rows[0]?.plan ?? 'free'
  } catch (err) {
    console.error('⚠️ Could not fetch plan from DB, defaulting to free:', err)
    return 'free'
  }
}
