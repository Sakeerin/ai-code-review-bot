import { NextResponse } from "next/server"
import { auth } from "@repo/db/auth"
import { db } from "@repo/db/client"
import { repositories } from "@repo/db/schema"
import { eq } from "@repo/db"
import { getUserOrg } from "@/lib/org"
import { headers } from "next/headers"
import { z } from "zod"

const PatchSchema = z.object({
  isActive: z.boolean(),
})

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ repoId: string }> },
) {
  const { repoId } = await params
  const requestHeaders = await headers()
  const session = await auth.api.getSession({ headers: requestHeaders })

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const org = await getUserOrg(session.user.id)
  if (!org) {
    return NextResponse.json({ error: "No organization found" }, { status: 404 })
  }

  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, repoId),
  })

  if (!repo || repo.orgId !== org.id) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 })
  }

  await db
    .update(repositories)
    .set({ isActive: parsed.data.isActive })
    .where(eq(repositories.id, repoId))

  return NextResponse.json({ success: true, isActive: parsed.data.isActive })
}
