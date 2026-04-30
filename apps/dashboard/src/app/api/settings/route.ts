import { NextResponse } from "next/server"
import { auth } from "@repo/db/auth"
import { db } from "@repo/db/client"
import { organizations } from "@repo/db/schema"
import { eq } from "@repo/db"
import { getUserOrg } from "@/lib/org"
import { headers } from "next/headers"
import { z } from "zod"

const SettingsSchema = z.object({
  slackWebhookUrl: z.string().url().or(z.literal("")).optional(),
})

export async function POST(req: Request) {
  const requestHeaders = await headers()
  const session = await auth.api.getSession({ headers: requestHeaders })

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const org = await getUserOrg(session.user.id)
  if (!org) {
    return NextResponse.json({ error: "No organization found" }, { status: 404 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = SettingsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 })
  }

  const slackWebhookUrl = parsed.data.slackWebhookUrl || null

  await db
    .update(organizations)
    .set({ slackWebhookUrl, updatedAt: new Date() })
    .where(eq(organizations.id, org.id))

  return NextResponse.json({ success: true })
}
