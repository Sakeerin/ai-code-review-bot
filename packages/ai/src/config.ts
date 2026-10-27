import { z } from 'zod'
import { parse } from 'yaml'
import picomatch from 'picomatch'

export const CustomRuleSchema = z.object({
  id: z.string(),
  severity: z.enum(['bug', 'suggestion', 'nitpick', 'praise']),
  message: z.string(),
})

export const LimitsSchema = z.object({
  max_file_size_lines: z.number().int().min(1).max(2000).default(500),
  max_files_per_pr: z.number().int().min(1).max(50).default(20),
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

export function isFileIgnored(filename: string, patterns: string[]): boolean {
  return patterns.length > 0 && picomatch.isMatch(filename.replace(/\\/g, '/').replace(/^\.\//, ''), patterns, { dot: true })
}

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
