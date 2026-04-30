import { z } from 'zod'
import { generateObject } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { buildSystemPrompt } from './prompts.js'
import type { ReviewBotConfig } from './config.js'

export * from './config.js'
export * from './patch.js'

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
}

export class ReviewError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'ReviewError'
  }
}

export async function reviewDiff(
  diffContent: string,
  config: ReviewBotConfig,
): Promise<ReviewResult & ReviewTokenUsage> {
  try {
    const anthropic = createAnthropic()
    const { object, usage } = await generateObject({
      model: anthropic(process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6'),
      schema: ReviewSchema,
      system: buildSystemPrompt(config),
      prompt: `Please review the following code changes:\n\n${diffContent}`,
    })

    return {
      ...object,
      tokensInput: usage.promptTokens,
      tokensOutput: usage.completionTokens,
    }
  } catch (error) {
    // Classify errors so callers can decide whether to retry
    const message = error instanceof Error ? error.message : String(error)
    const statusCode = (error as { statusCode?: number; status?: number }).statusCode
      ?? (error as { statusCode?: number; status?: number }).status

    if (statusCode === 429) {
      // Rate-limited by Anthropic — safe to retry with backoff
      throw new ReviewError(`Claude API rate limited: ${message}`, true, error)
    }

    if (statusCode && statusCode >= 500) {
      // Anthropic server error — safe to retry
      throw new ReviewError(`Claude API server error (${statusCode}): ${message}`, true, error)
    }

    if (statusCode === 400 || message.includes('schema') || message.includes('JSON')) {
      // Bad request / schema mismatch — retrying won't help
      throw new ReviewError(`Claude API schema/request error: ${message}`, false, error)
    }

    // Unknown error (network, timeout) — retry
    throw new ReviewError(`Claude API error: ${message}`, true, error)
  }
}
