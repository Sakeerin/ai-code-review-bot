import { auth } from "@repo/db/auth"
import { headers } from "next/headers"
import { getUserOrg, getUsageSummary, PLAN_LIMITS } from "@/lib/org"

export default async function DashboardMainPage() {
  const requestHeaders = await headers()
  const session = await auth.api.getSession({ headers: requestHeaders })

  const org = session?.user ? await getUserOrg(session.user.id) : null
  const usage = org ? await getUsageSummary(org) : null

  const plan = (org?.plan ?? "free") as keyof typeof PLAN_LIMITS
  const planMeta = PLAN_LIMITS[plan]

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Overview</h1>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Welcome */}
        <div className="border border-border rounded-xl p-6 bg-card text-card-foreground shadow-sm">
          <h3 className="font-semibold text-sm text-muted-foreground">Welcome back</h3>
          <p className="text-2xl font-bold mt-2">{session?.user?.name}</p>
          <p className="text-sm text-muted-foreground mt-1">{session?.user?.email}</p>
        </div>

        {/* GitHub App */}
        <div className="border border-border rounded-xl p-6 bg-card text-card-foreground shadow-sm">
          <h3 className="font-semibold text-sm text-muted-foreground">GitHub App</h3>
          {org ? (
            <div className="mt-2 space-y-1">
              <p className="font-semibold">{org.name}</p>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                Connected
              </span>
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

        {/* PR Usage */}
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

      {/* Quick actions */}
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
