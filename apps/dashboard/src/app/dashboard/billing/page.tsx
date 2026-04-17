"use client"

import { useState, useEffect } from "react"
import { BillingIntervalToggle } from "@/components/billing-interval-toggle"
import { UpgradeButton } from "@/components/upgrade-button"
import { ManageSubscriptionButton } from "@/components/manage-subscription-button"
import { PLAN_LIMITS, OVERAGE_PRICE_PER_PR, type Plan, type BillingInterval } from "@/lib/org"

// ─── Types (server-fetched data passed as props from a server wrapper) ──

interface BillingPageProps {
  plan: Plan
  orgName: string | null
  hasStripeCustomer: boolean
  usage: {
    used: number
    limit: number
    percent: number
    overageCount: number
    overageCost: number
  } | null
  successParam: boolean
}

// ─── Plan features ───────────────────────────────────────────────

const PLAN_FEATURES: Record<Plan, string[]> = {
  free:     ["50 PR reviews / month", "1 repository", "GitHub + GitLab", "Framework profiles", "Community support"],
  team:     ["500 PR reviews / month", "Unlimited repositories", "Custom YAML rules", "Usage analytics", "Slack notifications", "$0.05/PR overage billing", "Email support"],
  business: ["Unlimited PR reviews", "Unlimited repositories", "Custom YAML rules", "Priority support", "99.9% SLA", "All Team features"],
}

// ─── Inner client component ──────────────────────────────────────

function BillingPageInner(props: BillingPageProps) {
  const { plan, hasStripeCustomer, usage, successParam } = props
  const [billing, setBilling] = useState<BillingInterval>("monthly")
  const meta = PLAN_LIMITS[plan]

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Billing & Usage</h1>
          <p className="text-muted-foreground mt-1">Manage your subscription and monitor review quota.</p>
        </div>
        {plan !== "free" && hasStripeCustomer && <ManageSubscriptionButton />}
      </div>

      {successParam && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Subscription updated successfully! Your plan is now active.
        </div>
      )}

      {/* Current plan + usage */}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="border border-border rounded-xl p-6 bg-card shadow-sm space-y-4">
          <h2 className="text-lg font-semibold">Current Plan</h2>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold">
              {meta.priceMonthly === 0 ? "$0" : `$${meta.priceMonthly}`}
            </span>
            {meta.priceMonthly > 0 && <span className="text-muted-foreground text-sm">/ month</span>}
          </div>
          <div className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-primary text-primary-foreground">
            {meta.label}
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
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-sm mb-1.5">
                  <span>PR Reviews</span>
                  <span className="font-medium tabular-nums">
                    {usage.used}
                    {meta.prs !== Infinity && ` / ${meta.prs}`}
                  </span>
                </div>
                {meta.prs !== Infinity ? (
                  <>
                    <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${usage.percent >= 90 ? "bg-destructive" : "bg-primary"}`}
                        style={{ width: `${usage.percent}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {Math.max(0, (meta.prs as number) - usage.used)} reviews remaining in quota
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">Unlimited reviews</p>
                )}
              </div>

              {/* Overage section for paid plans */}
              {usage.overageCount > 0 && (
                <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-3 space-y-1">
                  <p className="text-sm font-medium text-orange-800">
                    Overage: {usage.overageCount} PR{usage.overageCount !== 1 ? "s" : ""}
                  </p>
                  <p className="text-xs text-orange-700">
                    Estimated overage charge: <span className="font-semibold">${usage.overageCost.toFixed(2)}</span>
                    {" "}(${OVERAGE_PRICE_PER_PR}/PR × {usage.overageCount} PRs)
                  </p>
                  <p className="text-xs text-orange-700">This will appear on your next Stripe invoice.</p>
                </div>
              )}

              {/* Warning: free plan approaching limit */}
              {plan === "free" && usage.percent >= 80 && usage.overageCount === 0 && (
                <div className="rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
                  You&apos;re approaching your monthly limit. Upgrade to avoid paused reviews.
                </div>
              )}

              {/* Free plan hard-blocked */}
              {plan === "free" && usage.used >= (meta.prs as number) && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  Monthly limit reached. New reviews are paused until next month.{" "}
                  <a href="#upgrade" className="underline font-medium">Upgrade now</a> to continue.
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Install the GitHub App to start tracking usage.</p>
          )}
        </div>
      </div>

      {/* Upgrade section */}
      {plan !== "business" && (
        <div id="upgrade" className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="text-lg font-semibold">Upgrade Your Plan</h2>
            <BillingIntervalToggle value={billing} onChange={setBilling} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {(["team", "business"] as const)
              .filter((p) => p !== plan)
              .map((p) => {
                const m = PLAN_LIMITS[p]
                const displayPrice = billing === "annual"
                  ? `$${m.priceAnnualPerMonth}/mo — $${m.priceAnnualTotal}/yr`
                  : `$${m.priceMonthly}/mo`
                const savings = m.priceMonthly * 12 - m.priceAnnualTotal

                return (
                  <div key={p} className="border border-border rounded-xl p-6 bg-card shadow-sm space-y-4">
                    <div className="flex items-baseline justify-between">
                      <span className="text-xl font-bold">{m.label}</span>
                      <div className="text-right">
                        <span className="font-bold">{displayPrice}</span>
                        {billing === "annual" && (
                          <p className="text-xs text-green-600">Save ${savings}/yr</p>
                        )}
                      </div>
                    </div>
                    <ul className="space-y-1.5 text-sm text-muted-foreground">
                      {PLAN_FEATURES[p].map((f) => (
                        <li key={f} className="flex items-center gap-2">
                          <span className="text-green-600">✓</span> {f}
                        </li>
                      ))}
                    </ul>
                    <UpgradeButton plan={p} billing={billing} className="w-full" />
                  </div>
                )
              })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Server data fetcher wrapper ─────────────────────────────────
// This is a client component that self-fetches on mount to avoid
// passing serialized server data through async RSC boundaries.

export default function BillingPage() {
  const [data, setData] = useState<BillingPageProps | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    fetch("/api/billing/summary")
      .then((r) => r.json())
      .then((d) => setData({ ...d, successParam: params.get("success") === "true" }))
      .catch(() => setData(null))
  }, [])

  if (!data) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-48 bg-secondary rounded" />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="h-64 bg-secondary rounded-xl" />
          <div className="h-64 bg-secondary rounded-xl" />
        </div>
      </div>
    )
  }

  return <BillingPageInner {...data} />
}
