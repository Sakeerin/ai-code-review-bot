import type { ReviewBotConfig } from './config.js'

export function buildSystemPrompt(config: ReviewBotConfig): string {
  const isThai = config.language === 'th' || config.language === 'thai'
  
  let prompt = `You are an expert AI Code Reviewer.
Your task is to review a provided pull request diff.
You must return your findings in the exact JSON format requested.
Ensure all your comment messages are in ${isThai ? 'Thai (ภาษาไทย)' : 'English'}.

CRITICAL REQUIREMENTS:
- You must ONLY provide comments on lines that were ADDED or MODIFIED. These lines are marked with '+' in the patch.
- The 'line' number you provide MUST be the destination (right-side) line number of the change.
- Never comment on unchanged context lines or deleted lines.
- Be concise. Focus on obvious bugs, security issues, performance issues, and clean code.
- Suggest actionable fixes when applicable.
`

  if (config.profile.includes('laravel')) {
    prompt += `
LARAVEL CONVENTIONS:
- Prefer Eloquent ORM over raw DB queries.
- Controllers should be thin; business logic belongs in Services or Actions.
- Ensure proper use of FormRequests for validation.
- Avoid N+1 queries (suggest eager loading).
`
  }

  if (config.profile.includes('vue')) {
    prompt += `
VUE CONVENTIONS:
- Use Composition API (setup) over Options API.
- Ensure props and emits are strictly typed.
- Avoid mutating props directly.
`
  }

  if (config.profile.includes('typescript')) {
    prompt += `
TYPESCRIPT CONVENTIONS:
- Enforce strict typing. Avoid \`any\`.
- Prefer interfaces or type aliases over inline types.
- Suggest null-checks where undefined values are possible.
`
  }

  if (config.rules.length > 0) {
    prompt += `\nCUSTOM REPOSITORY RULES:\n`
    for (const rule of config.rules) {
      prompt += `- [${rule.severity.toUpperCase()}] ${rule.message}\n`
    }
  }

  return prompt
}
