/**
 * POST /api/review/diff
 * Used by the VS Code extension to review a diff without a PR.
 * Requires a Bearer API key (future: org API keys table).
 * For now, validates the key against REVIEW_API_KEY env var for simplicity.
 */
import { NextResponse } from "next/server"
import { reviewDiff, parseReviewBotConfig } from "@repo/ai"
import { z } from "zod"

const RequestSchema = z.object({
  diff: z.string().min(1).max(100_000),
  profile: z.string().default("typescript"),
  language: z.string().default("en"),
})

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization")
  const expectedKey = process.env.REVIEW_API_KEY
  if (!expectedKey || authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
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

  const { diff, profile, language } = parsed.data
  const config = parseReviewBotConfig(`profile: ${profile}\nlanguage: ${language}`)

  try {
    const result = await reviewDiff(diff, config)
    return NextResponse.json({
      score: result.score,
      summary: result.summary,
      comments: result.comments,
      tokensUsed: result.tokensInput + result.tokensOutput,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: "Review failed", message }, { status: 500 })
  }
}
