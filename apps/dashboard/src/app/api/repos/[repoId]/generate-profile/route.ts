import { NextResponse } from "next/server"
import { auth } from "@repo/db/auth"
import { db } from "@repo/db/client"
import { repositories } from "@repo/db/schema"
import { eq } from "@repo/db"
import { getUserOrg } from "@/lib/org"
import { headers } from "next/headers"
import { generateConventionProfile, type RepoFileSample } from "@repo/ai"
import { z } from "zod"

const RequestSchema = z.object({
  files: z.array(z.object({
    path: z.string(),
    content: z.string(),
  })).min(1).max(30),
})

/**
 * POST /api/repos/[repoId]/generate-profile
 * Accepts a sample of repo files and returns a generated .reviewbot.yml.
 */
export async function POST(
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

  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const files = parsed.data.files as RepoFileSample[]
    const result = await generateConventionProfile(files, repo.fullName)

    // Optionally persist the generated profile as the repo's convention config
    // (caller can choose to apply it)
    return NextResponse.json({
      success: true,
      yaml: result.yaml,
      profile: result.profile,
      repoFullName: repo.fullName,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: "Profile generation failed", message }, { status: 500 })
  }
}
