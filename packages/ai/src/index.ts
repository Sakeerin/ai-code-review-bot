import { z } from 'zod'

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

// Placeholder — will be implemented in Phase 2
export async function reviewDiff(
  _diff: string,
  _conventionProfile?: string,
): Promise<ReviewResult> {
  // TODO: Phase 2 — Claude integration
  return {
    comments: [],
    summary: 'AI review not yet implemented (Phase 2)',
    score: 0,
  }
}
