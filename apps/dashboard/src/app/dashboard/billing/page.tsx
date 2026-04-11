import { auth } from "@repo/db/auth"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getUserOrg, getUsageSummary, PLAN_LIMITS, type Plan } from "@/lib/org"
import { UpgradeButton } from "@/components/upgrade-button"
import { ManageSubscriptionButton } from "@/components/manage-subscription-button"

const PLAN_FEATURES: Record<Plan, string[]> = {
  free:     ["50 PR reviews / month", "1 repository", "Built-in framework profiles", "Community support"],
  team:     ["500 PR reviews / month", "Unlimited repositories", "Custom YAML rules", "Email support"],
  business: ["Unlimited PR reviews", "Unlimited repositories", "Custom YAML rules", "Priority support", "Overage billing"],
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string }>
}) {
  const params = await searchParams
  const requestHeaders = await headers()
  const session = await auth.api.getSession({ headers: requestHeaders })

  if (!session?.user) {
    redirect("/")
  }

  const org = await getUserOrg(session.user.id)
  const usage = org ? await getUsageSummary(org) : null

  const plan = (org?.plan ?? "free") as Plan
  const planMeta = PLAN_LIMITS[plan]

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Billing & Usage</h1>
          <p className="text-muted-foreground mt-1">
            Manage your subscription and monitor review quota.
          </p>
        </div>
        {plan !== "free" && org && <ManageSubscriptionButton />}
      </div>

      {params.success === "true" && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Subscription updated successfully! Your plan is now active.
        </div>
      )}

      {/* Current plan + usage */}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="border border-border rounded-xl p-6 bg-card shadow-sm space-y-4">
          <h2 className="text-lg font-semibold">Current Plan</h2>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold">{planMeta.price}</span>
            {planMeta.priceMonthly > 0 && (
              <span className="text-muted-foreground text-sm">/ month</span>
            )}
          </div>
          <div className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-primary text-primary-foreground">
            {planMeta.label}
          </div>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            {PLAN_FEATURES[plan].map((f) => (
              <li key={f} className="flex items-center gap-2">
                <span className="text-green-600">✓</span> {f}
              </li>
            ))}
          </ul>
        </div>

        <div className="border border-border rounded-xl p-6 bg-card shadow-sm space-y-4">
          <h2 className="text-lg font-semibold">Usage This Month</h2>
          {usage ? (
            <>
              <div>
                <div className="flex justify-between text-sm mb-1.5">
                  <span>PR Reviews</span>
                  <span className="font-medium tabular-nums">
                    {usage.used}
                    {planMeta.prs !== Infinity && ` / ${planMeta.prs}`}
                  </span>
                </div>
                {planMeta.prs !== Infinity ? (
                  <>
                    <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${usage.percent >= 90 ? "bg-destructive" : "bg-primary"}`}
                        style={{ width: `${usage.percent}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {planMeta.prs - usage.used} reviews remaining
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">Unlimited reviews on {planMeta.label} plan</p>
                )}
              </div>

              {plan === "free" && usage.percent >= 80 && (
                <div className="rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
                  You&apos;re approaching your monthly limit. Upgrade to avoid interruptions.
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Install the GitHub App to start tracking usage.
            </p>
          )}
        </div>
      </div>

      {/* Plan comparison — only show upgrade options */}
      {plan !== "business" && (
        <div>
          <h2 className="text-lg font-semibold mb-4">Upgrade Your Plan</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {(["team", "business"] as const)
              .filter((p) => p !== plan)
              .map((p) => {
                const meta = PLAN_LIMITS[p]
                return (
                  <div
                    key={p}
                    className="border border-border rounded-xl p-6 bg-card shadow-sm space-y-4"
                  >
                    <div className="flex items-baseline justify-between">
                      <span className="text-xl font-bold">{meta.label}</span>
                      <div className="text-right">
                        <span className="text-2xl font-bold">{meta.price}</span>
                        <span className="text-muted-foreground text-sm"> / mo</span>
                      </div>
                    </div>
                    <ul className="space-y-1.5 text-sm text-muted-foreground">
                      {PLAN_FEATURES[p].map((f) => (
                        <li key={f} className="flex items-center gap-2">
                          <span className="text-green-600">✓</span> {f}
                        </li>
                      ))}
                    </ul>
                    <UpgradeButton plan={p} className="w-full" />
                  </div>
                )
              })}
          </div>
        </div>
      )}
    </div>
  )
}
