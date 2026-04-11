import { auth } from "@repo/db/auth"
import { NextResponse } from "next/server"
import Stripe from "stripe"
import { getUserOrg } from "@/lib/org"
import { headers } from "next/headers"

const PRICE_IDS: Record<string, string | undefined> = {
  team:     process.env.STRIPE_TEAM_PRICE_ID,
  business: process.env.STRIPE_BUSINESS_PRICE_ID,
}

export async function POST(req: Request) {
  const requestHeaders = await headers()
  const session = await auth.api.getSession({ headers: requestHeaders })

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { plan } = (await req.json()) as { plan: string }

  const priceId = PRICE_IDS[plan]
  if (!priceId) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 })
  }

  const org = await getUserOrg(session.user.id)
  if (!org) {
    return NextResponse.json({ error: "No organization found. Install the GitHub App first." }, { status: 400 })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
    apiVersion: "2026-03-25.dahlia",
  })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: org.id,
    customer_email: session.user.email,
    metadata: { plan, orgId: org.id },
    success_url: `${appUrl}/dashboard/billing?success=true`,
    cancel_url: `${appUrl}/dashboard/billing`,
    ...(org.stripeCustomerId ? { customer: org.stripeCustomerId } : {}),
  })

  return NextResponse.json({ url: checkoutSession.url })
}
