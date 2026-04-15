import { auth } from "@repo/db/auth"
import { headers } from "next/headers"
import { AnalyticsLineChart } from "@/components/analytics-chart"
import { getDashboardAnalytics, getUserOrg, getUsageSummary, PLAN_LIMITS } from "@/lib/org"

export default async function DashboardMainPage() {
  const requestHeaders = await headers()
  const session = await auth.api.getSession({ headers: requestHeaders })

  const org = session?.user ? await getUserOrg(session.user.id) : null
  const usage = org ? await getUsageSummary(org) : null
  const analytics = org ? await getDashboardAnalytics(org.id) : null

  const plan = (org?.plan ?? "free") as keyof typeof PLAN_LIMITS
  const planMeta = PLAN_LIMITS[plan]

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Overview</h1>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="border border-border rounded-xl p-6 bg-card text-card-foreground shadow-sm">
          <h3 className="font-semibold text-sm text-muted-foreground">Welcome back</h3>
          <p className="text-2xl font-bold mt-2">{session?.user?.name}</p>
          <p className="text-sm text-muted-foreground mt-1">{session?.user?.email}</p>
        </div>

        <div className="border border-border rounded-xl p-6 bg-card text-card-foreground shadow-sm">
          <h3 className="font-semibold text-sm text-muted-foreground">Connected Platforms</h3>
          {org ? (
            <div className="mt-2 space-y-1">
              <p className="font-semibold">{org.name}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                  GitHub {analytics?.totals.githubRepos ?? 0}
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800">
                  GitLab {analytics?.totals.gitlabRepos ?? 0}
                </span>
              </div>
            </div>
          ) : (
            <div className="mt-4">
              <a
                href={`https://github.com/apps/${process.env.GITHUB_APP_SLUG ?? "ai-review-bot"}/installations/new`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
              >
                Install on GitHub
              </a>
            </div>
          )}
        </div>

        <div className="border border-border rounded-xl p-6 bg-card text-card-foreground shadow-sm">
          <h3 className="font-semibold text-sm text-muted-foreground">PRs Reviewed This Month</h3>
          {usage ? (
            <>
              <p className="text-2xl font-bold mt-2">
                {usage.used}
                {planMeta.prs !== Infinity && (
                  <span className="text-base font-normal text-muted-foreground"> / {planMeta.prs}</span>
                )}
              </p>
              {planMeta.prs !== Infinity && (
                <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden mt-3">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${usage.percent}%` }}
                  />
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-1 capitalize">{planMeta.label} Plan</p>
            </>
          ) : (
            <>
              <p className="text-2xl font-bold mt-2">—</p>
              <p className="text-xs text-muted-foreground mt-1">Install the GitHub App to start</p>
            </>
          )}
        </div>
      </div>

      {analytics && (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="border border-border rounded-xl p-6 bg-card text-card-foreground shadow-sm">
              <h3 className="font-semibold text-sm text-muted-foreground">Reviews (30d)</h3>
              <p className="text-2xl font-bold mt-2 tabular-nums">{analytics.totals.reviews}</p>
            </div>
            <div className="border border-border rounded-xl p-6 bg-card text-card-foreground shadow-sm">
              <h3 className="font-semibold text-sm text-muted-foreground">Tokens (30d)</h3>
              <p className="text-2xl font-bold mt-2 tabular-nums">{analytics.totals.tokens.toLocaleString()}</p>
            </div>
            <div className="border border-border rounded-xl p-6 bg-card text-card-foreground shadow-sm">
              <h3 className="font-semibold text-sm text-muted-foreground">Bugs Found (30d)</h3>
              <p className="text-2xl font-bold mt-2 tabular-nums">{analytics.totals.bugsFound}</p>
            </div>
            <div className="border border-border rounded-xl p-6 bg-card text-card-foreground shadow-sm">
              <h3 className="font-semibold text-sm text-muted-foreground">Average Score (30d)</h3>
              <p className="text-2xl font-bold mt-2 tabular-nums">{analytics.totals.averageScore ?? "—"}</p>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <AnalyticsLineChart
              title="Token Usage"
              subtitle="Daily AI token usage across GitHub and GitLab reviews"
              points={analytics.charts.tokenUsage}
              colorClassName="text-sky-600"
            />
            <AnalyticsLineChart
              title="Bugs Found"
              subtitle="Daily bug-severity findings detected by the reviewer"
              points={analytics.charts.bugsFound}
              colorClassName="text-rose-600"
            />
            <AnalyticsLineChart
              title="PR Score Trend"
              subtitle="Average daily quality score for completed reviews"
              points={analytics.charts.scoreTrend}
              colorClassName="text-emerald-600"
            />
          </div>
        </>
      )}

      {org && (
        <div className="border border-border rounded-xl p-6 bg-card text-card-foreground shadow-sm">
          <h2 className="font-semibold mb-3">Quick Links</h2>
          <div className="flex flex-wrap gap-3">
            <a href="/dashboard/repos" className="inline-flex h-9 items-center justify-center rounded-md border border-border px-4 text-sm font-medium hover:bg-accent transition-colors">
              View Repositories
            </a>
            <a href="/dashboard/history" className="inline-flex h-9 items-center justify-center rounded-md border border-border px-4 text-sm font-medium hover:bg-accent transition-colors">
              Review History
            </a>
            <a href="/dashboard/billing" className="inline-flex h-9 items-center justify-center rounded-md border border-border px-4 text-sm font-medium hover:bg-accent transition-colors">
              Billing & Usage
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
