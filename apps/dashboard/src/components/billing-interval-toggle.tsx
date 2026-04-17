"use client"

import { cn } from "@/lib/utils"
import type { BillingInterval } from "@/lib/org"

interface BillingIntervalToggleProps {
  value: BillingInterval
  onChange: (v: BillingInterval) => void
  className?: string
}

export function BillingIntervalToggle({ value, onChange, className }: BillingIntervalToggleProps) {
  return (
    <div className={cn("inline-flex items-center gap-3 text-sm", className)}>
      <button
        onClick={() => onChange("monthly")}
        className={cn(
          "font-medium transition-colors",
          value === "monthly" ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        Monthly
      </button>

      <button
        role="switch"
        aria-checked={value === "annual"}
        onClick={() => onChange(value === "monthly" ? "annual" : "monthly")}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none",
          value === "annual" ? "bg-primary" : "bg-input",
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform",
            value === "annual" ? "translate-x-5" : "translate-x-0",
          )}
        />
      </button>

      <button
        onClick={() => onChange("annual")}
        className={cn(
          "font-medium transition-colors",
          value === "annual" ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        Annual
        <span className="ml-1.5 inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
          Save 20%
        </span>
      </button>
    </div>
  )
}
