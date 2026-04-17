import { db } from "@repo/db/client"
import {
  organizations,
  repositories,
  reviews,
  userOrganizations,
  type Organization,
} from "@repo/db/schema"
import { and, count, desc, eq, gte } from "@repo/db"

// ─── Plan metadata ────────────────────────────────────────────────

export const PLAN_LIMITS = {
  free: {
    prs: 50, repos: 1, label: "Free",
    priceMonthly: 0,  priceAnnualPerMonth: 0,  priceAnnualTotal: 0,
    overagePerPr: 0,  allowsOverage: false,
  },
  team: {
    prs: 500, repos: -1, label: "Team",
    priceMonthly: 19, priceAnnualPerMonth: 15, priceAnnualTotal: 180,
    overagePerPr: 0.05, allowsOverage: true,
  },
  business: {
    prs: Infinity, repos: -1, label: "Business",
    priceMonthly: 49, priceAnnualPerMonth: 39, priceAnnualTotal: 468,
    overagePerPr: 0.05, allowsOverage: true,
  },
} as const satisfies Record<string, {
  prs: number; repos: number; label: string;
  priceMonthly: number; priceAnnualPerMonth: number; priceAnnualTotal: number;
  overagePerPr: number; allowsOverage: boolean;
}>

export type Plan = keyof typeof PLAN_LIMITS
export type BillingInterval = "monthly" | "annual"

export const OVERAGE_PRICE_PER_PR = 0.05

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
 * Returns quota usage for the current calendar month.
 * overageCount > 0 only when on a paid plan that allows overage.
 */
export async function getUsageSummary(org: Organization) {
  const plan = (org.plan ?? "free") as Plan
  const meta = PLAN_LIMITS[plan]
  const limit = meta.prs
  const used = await getMonthlyReviewCount(org.id)
  const overageCount = limit !== Infinity && used > limit ? used - limit : 0
  const withinQuota = Math.min(used, limit === Infinity ? used : limit)
  const percent = limit === Infinity ? 0 : Math.min(100, Math.round((withinQuota / limit) * 100))
  const overageCost = overageCount * meta.overagePerPr

  return { used, limit, percent, overageCount, overageCost }
}

export interface AnalyticsPoint {
  date: string
  value: number
}

export interface DashboardAnalytics {
  totals: {
    reviews: number
    tokens: number
    bugsFound: number
    averageScore: number | null
    githubRepos: number
    gitlabRepos: number
  }
  charts: {
    tokenUsage: AnalyticsPoint[]
    bugsFound: AnalyticsPoint[]
    scoreTrend: AnalyticsPoint[]
  }
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

function formatChartLabel(key: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(`${key}T00:00:00.000Z`))
}

function buildDateSeries(days: number) {
  const dates: string[] = []
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  for (let index = days - 1; index >= 0; index--) {
    const date = new Date(today)
    date.setUTCDate(today.getUTCDate() - index)
    dates.push(dayKey(date))
  }

  return dates
}

export async function getDashboardAnalytics(orgId: string): Promise<DashboardAnalytics> {
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - 29)
  since.setUTCHours(0, 0, 0, 0)

  const repoRows = await db
    .select({
      provider: repositories.provider,
    })
    .from(repositories)
    .where(eq(repositories.orgId, orgId))

  const reviewRows = await db
    .select({
      createdAt: reviews.createdAt,
      tokensInput: reviews.tokensInput,
      bugsFound: reviews.bugsFound,
      score: reviews.score,
    })
    .from(reviews)
    .innerJoin(repositories, eq(reviews.repoId, repositories.id))
    .where(
      and(
        eq(repositories.orgId, orgId),
        eq(reviews.status, "completed"),
        gte(reviews.createdAt, since),
      ),
    )
    .orderBy(desc(reviews.createdAt))

  const dateKeys = buildDateSeries(30)
  const tokenMap = new Map<string, number>()
  const bugMap = new Map<string, number>()
  const scoreMap = new Map<string, { sum: number; count: number }>()

  let totalTokens = 0
  let totalBugs = 0
  let totalScore = 0
  let scoredReviews = 0

  for (const review of reviewRows) {
    if (!review.createdAt) continue

    const key = dayKey(review.createdAt)
    totalTokens += review.tokensInput
    totalBugs += review.bugsFound ?? 0

    tokenMap.set(key, (tokenMap.get(key) ?? 0) + review.tokensInput)
    bugMap.set(key, (bugMap.get(key) ?? 0) + (review.bugsFound ?? 0))

    if (review.score !== null) {
      totalScore += review.score
      scoredReviews++

      const existing = scoreMap.get(key) ?? { sum: 0, count: 0 }
      existing.sum += review.score
      existing.count += 1
      scoreMap.set(key, existing)
    }
  }

  return {
    totals: {
      reviews: reviewRows.length,
      tokens: totalTokens,
      bugsFound: totalBugs,
      averageScore: scoredReviews > 0 ? Math.round(totalScore / scoredReviews) : null,
      githubRepos: repoRows.filter((repo) => repo.provider === "github").length,
      gitlabRepos: repoRows.filter((repo) => repo.provider === "gitlab").length,
    },
    charts: {
      tokenUsage: dateKeys.map((key) => ({
        date: formatChartLabel(key),
        value: tokenMap.get(key) ?? 0,
      })),
      bugsFound: dateKeys.map((key) => ({
        date: formatChartLabel(key),
        value: bugMap.get(key) ?? 0,
      })),
      scoreTrend: dateKeys.map((key) => {
        const score = scoreMap.get(key)
        return {
          date: formatChartLabel(key),
          value: score ? Math.round(score.sum / score.count) : 0,
        }
      }),
    },
  }
}
