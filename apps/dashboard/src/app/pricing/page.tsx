"use client"

import { useState } from "react"
import Link from "next/link"
import { BillingIntervalToggle } from "@/components/billing-interval-toggle"
import { UpgradeButton } from "@/components/upgrade-button"
import { PLAN_LIMITS, type BillingInterval } from "@/lib/org"

// ─── Feature matrix ─────────────────────────────────────────────

type FeatureRow = {
  label: string
  free: string | boolean
  team: string | boolean
  business: string | boolean
  enterprise: string | boolean
}

const FEATURES: FeatureRow[] = [
  { label: "PR reviews / month",    free: "50",          team: "500",        business: "Unlimited", enterprise: "Unlimited" },
  { label: "Repositories",          free: "1",           team: "Unlimited",  business: "Unlimited", enterprise: "Unlimited" },
  { label: "GitHub support",        free: true,          team: true,         business: true,        enterprise: true },
  { label: "GitLab support",        free: true,          team: true,         business: true,        enterprise: true },
  { label: "Framework profiles",    free: true,          team: true,         business: true,        enterprise: true },
  { label: "Thai language reviews", free: true,          team: true,         business: true,        enterprise: true },
  { label: "Custom YAML rules",     free: false,         team: true,         business: true,        enterprise: true },
  { label: "Usage analytics",       free: false,         team: true,         business: true,        enterprise: true },
  { label: "Slack notifications",   free: false,         team: true,         business: true,        enterprise: true },
  { label: "Overage billing",       free: false,         team: "$0.05 / PR", business: "$0.05 / PR", enterprise: "Custom" },
  { label: "Priority support",      free: false,         team: false,        business: true,        enterprise: true },
  { label: "SLA guarantee",         free: false,         team: false,        business: "99.9%",     enterprise: "99.99%" },
  { label: "Self-hosted option",    free: false,         team: false,        business: false,       enterprise: true },
  { label: "Dedicated engineer",    free: false,         team: false,        business: false,       enterprise: true },
]

const FAQS = [
  {
    q: "What counts as a PR review?",
    a: "Each time the bot posts a review on a pull request (opened, updated, or reopened) counts as one PR review. Re-reviews on the same PR also count.",
  },
  {
    q: "What happens when I hit my monthly limit?",
    a: "On the Free plan, new reviews are paused until the next month. On Team and Business plans, reviews continue at $0.05 per PR with automatic billing via Stripe.",
  },
  {
    q: "Can I switch between monthly and annual billing?",
    a: "Yes. You can switch through the Stripe customer portal at any time. Proration is handled automatically.",
  },
  {
    q: "Is the annual plan billed upfront?",
    a: "Yes — annual plans are charged as a single payment at the start of each year. You save 20% compared to monthly billing.",
  },
  {
    q: "Do you store my code?",
    a: "No. We process the PR diff in memory to generate the review and only store metadata (file names, line counts, scores). Raw code is never persisted.",
  },
  {
    q: "Can I use this with private repositories?",
    a: "Yes. The GitHub App only requests the minimum permissions needed: read access to contents and write access to pull requests.",
  },
]

// ─── Sub-components ──────────────────────────────────────────────

function FeatureValue({ v }: { v: string | boolean }) {
  if (v === true)  return <span className="text-green-600 text-lg">✓</span>
  if (v === false) return <span className="text-muted-foreground text-lg">–</span>
  return <span className="text-sm font-medium">{v}</span>
}

// ─── Page ────────────────────────────────────────────────────────

export default function PricingPage() {
  const [billing, setBilling] = useState<BillingInterval>("monthly")

  const teamMeta     = PLAN_LIMITS.team
  const businessMeta = PLAN_LIMITS.business

  const teamPrice     = billing === "annual" ? `$${teamMeta.priceAnnualPerMonth}` : `$${teamMeta.priceMonthly}`
  const businessPrice = billing === "annual" ? `$${businessMeta.priceAnnualPerMonth}` : `$${businessMeta.priceMonthly}`
  const teamSub       = billing === "annual" ? `$${teamMeta.priceAnnualTotal}/yr — save $${teamMeta.priceMonthly * 12 - teamMeta.priceAnnualTotal}` : "per month"
  const businessSub   = billing === "annual" ? `$${businessMeta.priceAnnualTotal}/yr — save $${businessMeta.priceMonthly * 12 - businessMeta.priceAnnualTotal}` : "per month"

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="font-bold text-lg">AI Code Review</Link>
          <div className="flex items-center gap-4">
            <Link href="/pricing/enterprise" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Enterprise</Link>
            <Link href="/" className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
              Get Started
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-16 space-y-20">

        {/* Hero */}
        <div className="text-center space-y-4">
          <h1 className="text-5xl font-bold tracking-tight">Simple, transparent pricing</h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Start free. Pay as you grow. No surprises.
          </p>
          <div className="flex justify-center pt-2">
            <BillingIntervalToggle value={billing} onChange={setBilling} />
          </div>
        </div>

        {/* Plan cards */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">

          {/* Free */}
          <div className="border border-border rounded-2xl p-6 bg-card space-y-6">
            <div>
              <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Free</p>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-4xl font-bold">$0</span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">forever</p>
            </div>
            <ul className="space-y-2 text-sm">
              <li className="flex gap-2"><span className="text-green-600">✓</span> 50 PR reviews / month</li>
              <li className="flex gap-2"><span className="text-green-600">✓</span> 1 repository</li>
              <li className="flex gap-2"><span className="text-green-600">✓</span> GitHub + GitLab</li>
              <li className="flex gap-2"><span className="text-green-600">✓</span> Framework profiles</li>
              <li className="flex gap-2 text-muted-foreground"><span>–</span> Custom rules</li>
              <li className="flex gap-2 text-muted-foreground"><span>–</span> Analytics</li>
            </ul>
            <Link
              href="/"
              className="block text-center h-10 leading-10 rounded-md border border-border text-sm font-medium hover:bg-accent transition-colors"
            >
              Get started free
            </Link>
          </div>

          {/* Team */}
          <div className="border-2 border-primary rounded-2xl p-6 bg-card space-y-6 relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              <span className="inline-flex items-center rounded-full bg-primary px-3 py-0.5 text-xs font-medium text-primary-foreground">
                Most popular
              </span>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Team</p>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-4xl font-bold">{teamPrice}</span>
                <span className="text-muted-foreground text-sm">/ mo</span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">{teamSub}</p>
            </div>
            <ul className="space-y-2 text-sm">
              <li className="flex gap-2"><span className="text-green-600">✓</span> 500 PR reviews / month</li>
              <li className="flex gap-2"><span className="text-green-600">✓</span> Unlimited repositories</li>
              <li className="flex gap-2"><span className="text-green-600">✓</span> Custom YAML rules</li>
              <li className="flex gap-2"><span className="text-green-600">✓</span> Usage analytics</li>
              <li className="flex gap-2"><span className="text-green-600">✓</span> Slack notifications</li>
              <li className="flex gap-2"><span className="text-green-600">✓</span> Overage: $0.05 / PR</li>
            </ul>
            <UpgradeButton plan="team" billing={billing} className="w-full">
              Get Team
            </UpgradeButton>
          </div>

          {/* Business */}
          <div className="border border-border rounded-2xl p-6 bg-card space-y-6">
            <div>
              <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Business</p>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-4xl font-bold">{businessPrice}</span>
                <span className="text-muted-foreground text-sm">/ mo</span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">{businessSub}</p>
            </div>
            <ul className="space-y-2 text-sm">
              <li className="flex gap-2"><span className="text-green-600">✓</span> Unlimited PR reviews</li>
              <li className="flex gap-2"><span className="text-green-600">✓</span> Unlimited repositories</li>
              <li className="flex gap-2"><span className="text-green-600">✓</span> Priority support</li>
              <li className="flex gap-2"><span className="text-green-600">✓</span> 99.9% SLA</li>
              <li className="flex gap-2"><span className="text-green-600">✓</span> All Team features</li>
            </ul>
            <UpgradeButton plan="business" billing={billing} className="w-full">
              Get Business
            </UpgradeButton>
          </div>

          {/* Enterprise */}
          <div className="border border-border rounded-2xl p-6 bg-card space-y-6">
            <div>
              <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Enterprise</p>
              <div className="mt-2">
                <span className="text-4xl font-bold">Custom</span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">Talk to us</p>
            </div>
            <ul className="space-y-2 text-sm">
              <li className="flex gap-2"><span className="text-green-600">✓</span> Unlimited everything</li>
              <li className="flex gap-2"><span className="text-green-600">✓</span> Self-hosted option</li>
              <li className="flex gap-2"><span className="text-green-600">✓</span> Dedicated engineer</li>
              <li className="flex gap-2"><span className="text-green-600">✓</span> 99.99% SLA</li>
              <li className="flex gap-2"><span className="text-green-600">✓</span> Custom contract</li>
            </ul>
            <Link
              href="/pricing/enterprise"
              className="block text-center h-10 leading-10 rounded-md border border-border text-sm font-medium hover:bg-accent transition-colors"
            >
              Contact Sales
            </Link>
          </div>
        </div>

        {/* Feature comparison table */}
        <div>
          <h2 className="text-2xl font-bold mb-6">Compare all features</h2>
          <div className="border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Feature</th>
                  <th className="text-center px-4 py-3 font-medium">Free</th>
                  <th className="text-center px-4 py-3 font-medium">Team</th>
                  <th className="text-center px-4 py-3 font-medium">Business</th>
                  <th className="text-center px-4 py-3 font-medium">Enterprise</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {FEATURES.map((row) => (
                  <tr key={row.label} className="hover:bg-secondary/20">
                    <td className="px-4 py-3 text-muted-foreground">{row.label}</td>
                    <td className="px-4 py-3 text-center"><FeatureValue v={row.free} /></td>
                    <td className="px-4 py-3 text-center"><FeatureValue v={row.team} /></td>
                    <td className="px-4 py-3 text-center"><FeatureValue v={row.business} /></td>
                    <td className="px-4 py-3 text-center"><FeatureValue v={row.enterprise} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* FAQ */}
        <div className="max-w-2xl mx-auto space-y-6">
          <h2 className="text-2xl font-bold text-center">Frequently asked questions</h2>
          <div className="space-y-4">
            {FAQS.map((faq) => (
              <div key={faq.q} className="border border-border rounded-xl p-5">
                <p className="font-medium">{faq.q}</p>
                <p className="text-sm text-muted-foreground mt-2">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="text-center border border-border rounded-2xl p-12 bg-card space-y-4">
          <h2 className="text-2xl font-bold">Ready to automate your code reviews?</h2>
          <p className="text-muted-foreground">Start for free. No credit card required.</p>
          <div className="flex justify-center gap-3 pt-2">
            <Link
              href="/"
              className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Get Started Free
            </Link>
            <Link
              href="/pricing/enterprise"
              className="inline-flex h-11 items-center justify-center rounded-md border border-border px-8 text-sm font-medium hover:bg-accent transition-colors"
            >
              Talk to Sales
            </Link>
          </div>
        </div>

      </main>
    </div>
  )
}
