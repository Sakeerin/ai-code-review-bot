"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import type { BillingInterval } from "@/lib/org"

interface UpgradeButtonProps {
  plan: "team" | "business"
  billing?: BillingInterval
  className?: string
  children?: React.ReactNode
}

export function UpgradeButton({ plan, billing = "monthly", className, children }: UpgradeButtonProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleClick = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, billing }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Something went wrong")
      window.location.href = data.url
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
      setLoading(false)
    }
  }

  const label = children ?? `Get ${plan.charAt(0).toUpperCase() + plan.slice(1)}`

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={loading}
        className={cn(
          "inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none",
          className,
        )}
      >
        {loading ? "Redirecting to Stripe…" : label}
      </button>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  )
}
