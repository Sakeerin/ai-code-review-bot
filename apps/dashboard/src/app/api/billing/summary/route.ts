import { auth } from "@repo/db/auth"
import { NextResponse } from "next/server"
import { getUserOrg, getUsageSummary } from "@/lib/org"
import { headers } from "next/headers"

export async function GET() {
  const requestHeaders = await headers()
  const session = await auth.api.getSession({ headers: requestHeaders })

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const org = await getUserOrg(session.user.id)
  const usage = org ? await getUsageSummary(org) : null

  return NextResponse.json({
    plan: org?.plan ?? "free",
    orgName: org?.name ?? null,
    hasStripeCustomer: !!org?.stripeCustomerId,
    usage,
  })
}
