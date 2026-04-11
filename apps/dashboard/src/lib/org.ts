import { db } from "@repo/db/client"
import {
  organizations,
  repositories,
  reviews,
  userOrganizations,
  type Organization,
} from "@repo/db/schema"
import { and, count, eq, gte } from "@repo/db"

// ─── Plan metadata ────────────────────────────────────────────────

export const PLAN_LIMITS = {
  free:     { prs: 50,       repos: 1,  label: "Free",     price: "$0",  priceMonthly: 0  },
  team:     { prs: 500,      repos: -1, label: "Team",     price: "$19", priceMonthly: 19 },
  business: { prs: Infinity, repos: -1, label: "Business", price: "$49", priceMonthly: 49 },
} as const satisfies Record<string, { prs: number; repos: number; label: string; price: string; priceMonthly: number }>

export type Plan = keyof typeof PLAN_LIMITS

// ─── User → Org lookup ───────────────────────────────────────────

/**
 * Returns the first organization the given user belongs to, or null.
 * Uses the userOrganizations join table created during GitHub App installation.
 */
export async function getUserOrg(userId: string): Promise<Organization | null> {
  const rows = await db
    .select({ org: organizations })
    .from(userOrganizations)
    .innerJoin(organizations, eq(userOrganizations.orgId, organizations.id))
    .where(eq(userOrganizations.userId, userId))
    .limit(1)

  return rows[0]?.org ?? null
}

// ─── Usage ───────────────────────────────────────────────────────

/** Returns the start-of-current-month Date (UTC midnight). */
function monthStart(): Date {
  const d = new Date()
  d.setUTCDate(1)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

/**
 * Counts completed PR reviews for the given org in the current calendar month.
 */
export async function getMonthlyReviewCount(orgId: string): Promise<number> {
  const result = await db
    .select({ count: count() })
    .from(reviews)
    .innerJoin(repositories, eq(reviews.repoId, repositories.id))
    .where(
      and(
        eq(repositories.orgId, orgId),
        gte(reviews.createdAt, monthStart()),
        eq(reviews.status, "completed"),
      ),
    )

  return result[0]?.count ?? 0
}

/**
 * Returns { used, limit, percent } for the current month's PR review quota.
 * limit === -1 means unlimited (Business plan).
 */
export async function getUsageSummary(org: Organization) {
  const plan = (org.plan ?? "free") as Plan
  const limit = PLAN_LIMITS[plan].prs
  const used = await getMonthlyReviewCount(org.id)
  const percent = limit === Infinity ? 0 : Math.min(100, Math.round((used / limit) * 100))

  return { used, limit, percent }
}
