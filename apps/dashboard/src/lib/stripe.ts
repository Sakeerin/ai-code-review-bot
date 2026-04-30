import Stripe from "stripe"

export const STRIPE_API_VERSION = "2026-03-25.dahlia" as const satisfies Stripe.LatestApiVersion

export function createStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured")
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION })
}
