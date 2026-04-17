"use client"

import { useState } from "react"
import Link from "next/link"

const TEAM_SIZES = ["1–5", "6–20", "21–50", "51–200", "200+"]

export default function EnterprisePage() {
  const [form, setForm] = useState({
    name: "", email: "", company: "", teamSize: "", message: "",
  })
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState("")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus("loading")
    setErrorMsg("")
    try {
      const res = await fetch("/api/contact/enterprise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? "Submission failed")
      }
      setStatus("success")
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong")
      setStatus("error")
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-4">
          <Link href="/" className="font-bold text-lg">AI Code Review</Link>
          <span className="text-muted-foreground">/</span>
          <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground">Pricing</Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm">Enterprise</span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-16">
        <div className="grid gap-12 lg:grid-cols-2">

          {/* Left: value prop */}
          <div className="space-y-8">
            <div className="space-y-3">
              <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Enterprise</p>
              <h1 className="text-4xl font-bold tracking-tight">Built for larger teams</h1>
              <p className="text-lg text-muted-foreground">
                Custom pricing, self-hosted deployment, and a dedicated engineer for onboarding.
              </p>
            </div>

            <ul className="space-y-4">
              {[
                { icon: "🏢", title: "Self-hosted option", desc: "Deploy inside your own infrastructure. Code never leaves your environment." },
                { icon: "⚡", title: "Dedicated engineer", desc: "A developer works with your team to configure profiles and tune review quality." },
                { icon: "📊", title: "99.99% SLA", desc: "Enterprise-grade uptime with priority incident response." },
                { icon: "🔒", title: "SSO & SAML", desc: "Integrate with Okta, Azure AD, or any SAML 2.0 provider." },
                { icon: "📋", title: "Custom contracts", desc: "MSA, DPA, and BAA available. Annual invoicing accepted." },
              ].map((item) => (
                <li key={item.title} className="flex gap-4">
                  <span className="text-2xl shrink-0">{item.icon}</span>
                  <div>
                    <p className="font-medium">{item.title}</p>
                    <p className="text-sm text-muted-foreground">{item.desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Right: form */}
          <div className="border border-border rounded-2xl p-8 bg-card">
            {status === "success" ? (
              <div className="text-center space-y-4 py-8">
                <div className="text-5xl">🎉</div>
                <h2 className="text-xl font-bold">Message received!</h2>
                <p className="text-muted-foreground text-sm">
                  We'll get back to you within 1 business day.
                </p>
                <Link
                  href="/pricing"
                  className="inline-flex h-9 items-center justify-center rounded-md border border-border px-4 text-sm font-medium hover:bg-accent transition-colors"
                >
                  Back to Pricing
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <h2 className="text-xl font-semibold">Contact Sales</h2>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Name *</label>
                    <input
                      required
                      type="text"
                      placeholder="Your name"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Work email *</label>
                    <input
                      required
                      type="email"
                      placeholder="you@company.com"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Company *</label>
                    <input
                      required
                      type="text"
                      placeholder="Acme Corp"
                      value={form.company}
                      onChange={(e) => setForm({ ...form, company: e.target.value })}
                      className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Team size</label>
                    <select
                      value={form.teamSize}
                      onChange={(e) => setForm({ ...form, teamSize: e.target.value })}
                      className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">Select…</option>
                      {TEAM_SIZES.map((s) => <option key={s} value={s}>{s} developers</option>)}
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">What are you looking for?</label>
                  <textarea
                    rows={4}
                    placeholder="Self-hosted deployment, custom rules, SLA requirements…"
                    value={form.message}
                    onChange={(e) => setForm({ ...form, message: e.target.value })}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                  />
                </div>

                {status === "error" && (
                  <p className="text-sm text-destructive">{errorMsg}</p>
                )}

                <button
                  type="submit"
                  disabled={status === "loading"}
                  className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {status === "loading" ? "Sending…" : "Send message"}
                </button>

                <p className="text-xs text-muted-foreground text-center">
                  We respond within 1 business day. No spam, ever.
                </p>
              </form>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
