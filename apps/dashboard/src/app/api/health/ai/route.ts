/**
 * GET /api/health/ai
 * Reports which AI providers are configured (have an API key) and the order in
 * which they will be tried. Useful to verify fallback setup without exposing keys.
 */
import { NextResponse } from "next/server"
import { getConfiguredProviderNames } from "@repo/ai"

export async function GET() {
  const configured = getConfiguredProviderNames()

  const providers = [
    { name: "openai", envVar: "OPENAI_API_KEY" },
    { name: "anthropic", envVar: "ANTHROPIC_API_KEY" },
    { name: "gemini", envVar: "GEMINI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY" },
  ].map((p) => ({
    ...p,
    configured: configured.includes(p.name),
  }))

  return NextResponse.json({
    ok: configured.length > 0,
    order: process.env.AI_PROVIDER_ORDER ?? "openai,anthropic,gemini",
    activeProvider: configured[0] ?? null,
    providers,
  })
}
