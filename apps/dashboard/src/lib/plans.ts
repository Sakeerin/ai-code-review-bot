/**
 * Pure plan metadata — no database, no server-only imports.
 *
 * Kept separate from ./org so that client components can import plan
 * constants without pulling the postgres driver into the browser bundle.
 */

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
