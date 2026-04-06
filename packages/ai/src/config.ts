import { z } from 'zod'
import { parse } from 'yaml'

export const CustomRuleSchema = z.object({
  id: z.string(),
  severity: z.enum(['bug', 'suggestion', 'nitpick', 'praise']),
  message: z.string(),
})

export const LimitsSchema = z.object({
  max_file_size_lines: z.number().default(500),
  max_files_per_pr: z.number().default(20),
}).default({})

export const ReviewBotConfigSchema = z.object({
  version: z.number().optional(),
  profile: z.string().default('typescript'),
  language: z.string().default('en'),
  rules: z.array(CustomRuleSchema).default([]),
  ignore: z.array(z.string()).default([]),
  limits: LimitsSchema,
}).default({})

export type ReviewBotConfig = z.infer<typeof ReviewBotConfigSchema>
export type CustomRule = z.infer<typeof CustomRuleSchema>

export function parseReviewBotConfig(ymlString: string | null): ReviewBotConfig {
  if (!ymlString) return ReviewBotConfigSchema.parse({})
  
  try {
    const raw = parse(ymlString)
    return ReviewBotConfigSchema.parse(raw || {})
  } catch (error) {
    console.error('Failed to parse .reviewbot.yml:', error)
    return ReviewBotConfigSchema.parse({})
  }
}
