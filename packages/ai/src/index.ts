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
    console.error('Claude API Error:', error)
    throw error
  }
}
