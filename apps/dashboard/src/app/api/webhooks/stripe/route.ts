import { NextResponse } from "next/server"
import type Stripe from "stripe"
import { db } from "@repo/db/client"
import { organizations, stripeWebhookEvents } from "@repo/db/schema"
import { eq, sql } from "@repo/db"
import { createStripe } from "@/lib/stripe"

const stripe = createStripe()

function planFromPriceId(priceId: string | undefined): "team" | "business" | null {
  if (!priceId) return null
  const teamIds = [
    process.env.STRIPE_TEAM_PRICE_ID,
    process.env.STRIPE_TEAM_ANNUAL_PRICE_ID,
  ].filter(Boolean)
  const businessIds = [
    process.env.STRIPE_BUSINESS_PRICE_ID,
    process.env.STRIPE_BUSINESS_ANNUAL_PRICE_ID,
  ].filter(Boolean)
  if (teamIds.includes(priceId)) return "team"
  if (businessIds.includes(priceId)) return "business"
  return null
}

export async function POST(req: Request) {
  const body = await req.text()
  const signature = req.headers.get("stripe-signature")

  let event: Stripe.Event

  try {
    if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
      throw new Error("Missing stripe-signature or STRIPE_WEBHOOK_SECRET")
    }
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error(`Stripe webhook error: ${message}`)
    return new NextResponse(`Webhook Error: ${message}`, { status: 400 })
  }

  // Idempotency: reject already-processed events (replay attack prevention)
  try {
    await db.insert(stripeWebhookEvents).values({ eventId: event.id })
  } catch {
    // Unique constraint violation → event was already processed
    console.log(`⚠️ Duplicate Stripe event ${event.id} — skipping`)
    return NextResponse.json({ received: true })
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session
        const orgId = session.client_reference_id
        const customerId = session.customer as string
        const plan = (session.metadata?.plan as "team" | "business") ?? "team"

        if (!orgId || !customerId) {
          console.warn(`checkout.session.completed missing orgId or customerId — event ${event.id}`)
          break // Permanent state — return 200, retrying won't help
        }

        const updated = await db
          .update(organizations)
          .set({ stripeCustomerId: customerId, plan })
          .where(eq(organizations.id, orgId))
          .returning({ id: organizations.id })

        if (updated.length === 0) {
          console.warn(`checkout.session.completed: org ${orgId} not found — acknowledging anyway`)
        }
        break
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string
        const priceId = subscription.items.data[0]?.price.id
        const plan = planFromPriceId(priceId)

        if (!plan) {
          console.warn(`subscription.updated: unrecognized priceId ${priceId} — event ${event.id}`)
          break // Unknown price — return 200, retrying won't resolve it
        }

        const updated = await db
          .update(organizations)
          .set({ plan })
          .where(eq(organizations.stripeCustomerId, customerId))
          .returning({ id: organizations.id })

        if (updated.length === 0) {
          console.warn(`subscription.updated: no org found for customer ${customerId}`)
        }
        break
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string

        const updated = await db
          .update(organizations)
          .set({ plan: "free" })
          .where(eq(organizations.stripeCustomerId, customerId))
          .returning({ id: organizations.id })

        if (updated.length === 0) {
          console.warn(`subscription.deleted: no org found for customer ${customerId}`)
        }
        break
      }

      default:
        // Unhandled events are silently ignored
        break
    }
  } catch (error) {
    console.error("Error processing Stripe webhook:", error)
    return new NextResponse("Internal Server Error", { status: 500 })
  }

  // Purge processed events older than 24h (Stripe stops retrying after ~8h)
  db.delete(stripeWebhookEvents)
    .where(sql`processed_at < NOW() - INTERVAL '24 hours'`)
    .catch(() => {/* non-fatal */})

  return NextResponse.json({ received: true })
}
