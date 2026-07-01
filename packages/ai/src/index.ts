import { z } from 'zod'
import { buildSystemPrompt } from './prompts.js'
import type { ReviewBotConfig } from './config.js'
import { generateObjectWithFallback } from './providers.js'

export * from './config.js'
export * from './patch.js'
export * from './profile-generator.js'
export * from './providers.js'

/**
 * Schema for structured review output from Claude.
 * Used with Vercel AI SDK's generateObject().
 */
export const ReviewSchema = z.object({
  comments: z.array(
    z.object({
      file: z.string().describe('File path relative to repo root'),
      line: z.number().describe('Line number in the file'),
      severity: z
        .enum(['bug', 'suggestion', 'nitpick', 'praise'])
        .describe('Severity level of the comment'),
      message: z.string().describe('Review comment message'),
      suggestion: z.string().optional().describe('Suggested code fix if applicable'),
    }),
  ),
  summary: z.string().describe('Overall review summary'),
  score: z
    .number()
    .min(0)
    .max(100)
    .describe('Code quality score from 0–100'),
})

export type ReviewResult = z.infer<typeof ReviewSchema>

export interface ReviewTokenUsage {
  tokensInput: number
  tokensOutput: number
  /** Which AI provider produced this review (e.g. "anthropic", "openai", "gemini"). */
  provider?: string
}

/**
 * Review a diff using the first available AI provider. Providers are tried in
 * order (see `AI_PROVIDER_ORDER`) and the pipeline automatically falls back to
 * the next one when a provider is unconfigured, out of quota, or failing.
 */
export async function reviewDiff(
  diffContent: string,
  config: ReviewBotConfig,
): Promise<ReviewResult & ReviewTokenUsage> {
  const { object, usage, provider } = await generateObjectWithFallback<ReviewResult>({
    schema: ReviewSchema,
    system: buildSystemPrompt(config),
    prompt: `Please review the following code changes:\n\n${diffContent}`,
  })

  return {
    ...object,
    tokensInput: usage.promptTokens,
    tokensOutput: usage.completionTokens,
    provider,
  }
}
