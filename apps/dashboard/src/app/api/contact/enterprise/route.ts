import { NextResponse } from "next/server"

interface EnterpriseLeadPayload {
  name: string
  email: string
  company: string
  teamSize?: string
  message?: string
}

export async function POST(req: Request) {
  const body = (await req.json()) as EnterpriseLeadPayload

  if (!body.name?.trim() || !body.email?.trim() || !body.company?.trim()) {
    return NextResponse.json({ error: "name, email, and company are required" }, { status: 400 })
  }

  // Log the lead for visibility (Axiom / Sentry / stdout)
  console.log("[enterprise-lead]", JSON.stringify({
    name: body.name,
    email: body.email,
    company: body.company,
    teamSize: body.teamSize ?? "—",
    message: body.message ?? "—",
    receivedAt: new Date().toISOString(),
  }))

  // TODO: send notification email via Resend/Loops when SUPPORT_EMAIL is configured
  // const supportEmail = process.env.SUPPORT_EMAIL
  // if (supportEmail) { await sendEmail({ to: supportEmail, ... }) }

  return NextResponse.json({ ok: true })
}
