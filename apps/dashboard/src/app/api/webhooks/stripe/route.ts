import { NextResponse } from "next/server"
import Stripe from "stripe"
import { db } from "@repo/db/client"
import { organizations } from "@repo/db/schema"
import { eq } from "@repo/db"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2026-03-25.dahlia",
})

function planFromPriceId(priceId: string | undefined): "team" | "business" | null {
  if (priceId === process.env.STRIPE_TEAM_PRICE_ID) return "team"
  if (priceId === process.env.STRIPE_BUSINESS_PRICE_ID) return "business"
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

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session
        const orgId = session.client_reference_id
        const customerId = session.customer as string
        const plan = (session.metadata?.plan as "team" | "business") ?? "team"

        if (orgId && customerId) {
          await db
            .update(organizations)
            .set({ stripeCustomerId: customerId, plan })
            .where(eq(organizations.id, orgId))
        }
        break
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string
        const priceId = subscription.items.data[0]?.price.id
        const plan = planFromPriceId(priceId)

        if (plan) {
          await db
            .update(organizations)
            .set({ plan })
            .where(eq(organizations.stripeCustomerId, customerId))
        }
        break
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string

        await db
          .update(organizations)
          .set({ plan: "free" })
          .where(eq(organizations.stripeCustomerId, customerId))
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

  return NextResponse.json({ received: true })
}
