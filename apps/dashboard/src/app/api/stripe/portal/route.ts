import { auth } from "@repo/db/auth"
import { NextResponse } from "next/server"
import { getUserOrg } from "@/lib/org"
import { createStripe } from "@/lib/stripe"
import { headers } from "next/headers"

export async function POST() {
  const requestHeaders = await headers()
  const session = await auth.api.getSession({ headers: requestHeaders })

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const org = await getUserOrg(session.user.id)
  if (!org?.stripeCustomerId) {
    return NextResponse.json({ error: "No active subscription found." }, { status: 400 })
  }

  const stripe = createStripe()

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: org.stripeCustomerId,
    return_url: `${appUrl}/dashboard/billing`,
  })

  return NextResponse.json({ url: portalSession.url })
}
