import { generateObject } from 'ai'
import type { LanguageModelV1 } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { z } from 'zod'

/**
 * Error thrown by the review pipeline. `retryable` tells the queue whether a
 * Trigger.dev retry has any chance of succeeding.
 */
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

/** A concrete model instance that is ready to call, plus a human-readable name. */
export interface ProviderCandidate {
  name: string
  model: LanguageModelV1
}

/**
 * Build the ordered list of AI providers that are actually configured.
 *
 * Order is controlled by `AI_PROVIDER_ORDER` (comma-separated, default
 * "anthropic,openai,gemini"). A provider is only included when its API key is
 * present in the environment, so unconfigured providers are silently skipped.
 */
export function getConfiguredProviders(): ProviderCandidate[] {
  const order = (process.env.AI_PROVIDER_ORDER ?? 'openai,anthropic,gemini')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

  const providers: ProviderCandidate[] = []

  for (const name of order) {
    if (name === 'anthropic' && process.env.ANTHROPIC_API_KEY) {
      const anthropic = createAnthropic()
      providers.push({
        name: 'anthropic',
        model: anthropic(process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6'),
      })
    }

    if (name === 'openai' && process.env.OPENAI_API_KEY) {
      const openai = createOpenAI()
      providers.push({
        name: 'openai',
        model: openai(process.env.OPENAI_MODEL ?? 'gpt-4o'),
      })
    }

    if (
      name === 'gemini' &&
      (process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY)
    ) {
      const google = createGoogleGenerativeAI({
        apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      })
      providers.push({
        name: 'gemini',
        model: google(process.env.GEMINI_MODEL ?? 'gemini-2.0-flash'),
      })
    }
  }

  return providers
}

/** Names of providers that have an API key configured (for diagnostics / health checks). */
export function getConfiguredProviderNames(): string[] {
  return getConfiguredProviders().map((p) => p.name)
}

type ErrorClass = {
  /** Should we move on to the next provider? */
  fallback: boolean
  /** If this is the last provider, should the queue retry the whole job later? */
  retryable: boolean
  reason: string
}

/**
 * Classify a provider error into: should we try the next provider, and — if this
 * was the last one — should the job be retried later.
 */
function classifyError(error: unknown): ErrorClass {
  const message = error instanceof Error ? error.message : String(error)
  const statusCode =
    (error as { statusCode?: number; status?: number }).statusCode ??
    (error as { statusCode?: number; status?: number }).status
  const lower = message.toLowerCase()

  // Quota exhausted / rate limited → try next provider; quota may reset later.
  if (
    statusCode === 429 ||
    lower.includes('quota') ||
    lower.includes('rate limit') ||
    lower.includes('insufficient_quota') ||
    lower.includes('exceeded')
  ) {
    return { fallback: true, retryable: true, reason: `quota/rate-limit (${statusCode ?? 'n/a'})` }
  }

  // Auth / permission problem → key is bad; try next provider, but do not retry
  // this same job if every provider is misconfigured.
  if (
    statusCode === 401 ||
    statusCode === 403 ||
    lower.includes('api key') ||
    lower.includes('unauthorized') ||
    lower.includes('permission')
  ) {
    return { fallback: true, retryable: false, reason: `auth (${statusCode ?? 'n/a'})` }
  }

  // Provider server error → try next provider; safe to retry later.
  if (statusCode && statusCode >= 500) {
    return { fallback: true, retryable: true, reason: `server error (${statusCode})` }
  }

  // Bad request / schema mismatch → same request will fail everywhere.
  if (statusCode === 400 || lower.includes('schema') || lower.includes('json')) {
    return { fallback: false, retryable: false, reason: 'schema/request' }
  }

  // Unknown (network, timeout) → try next provider; retry later.
  return { fallback: true, retryable: true, reason: 'unknown/network' }
}

export interface FallbackResult<T> {
  object: T
  usage: { promptTokens: number; completionTokens: number }
  /** Which provider actually produced the result. */
  provider: string
}

/**
 * Run `generateObject` across the configured providers in order, falling back to
 * the next provider when one is unavailable (not configured), out of quota, rate
 * limited, or erroring. Throws a `ReviewError` only when every provider fails.
 */
export async function generateObjectWithFallback<T>(opts: {
  schema: z.ZodType<T>
  system: string
  prompt: string
}): Promise<FallbackResult<T>> {
  const providers = getConfiguredProviders()

  if (providers.length === 0) {
    throw new ReviewError(
      'No AI provider configured. Set at least one of ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY.',
      false,
    )
  }

  let lastError: unknown
  let lastClass: ErrorClass | undefined

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i]!
    const isLast = i === providers.length - 1

    try {
      const { object, usage } = await generateObject({
        model: provider.model,
        schema: opts.schema,
        system: opts.system,
        prompt: opts.prompt,
      })
      return {
        object,
        usage: {
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
        },
        provider: provider.name,
      }
    } catch (error) {
      lastError = error
      lastClass = classifyError(error)
      const message = error instanceof Error ? error.message : String(error)

      if (lastClass.fallback && !isLast) {
        console.warn(
          `[ai] provider "${provider.name}" failed (${lastClass.reason}); falling back to "${providers[i + 1]!.name}". ${message}`,
        )
        continue
      }

      if (!lastClass.fallback) {
        // Fatal for all providers (e.g. schema mismatch) — stop immediately.
        throw new ReviewError(`AI request error (${provider.name}): ${message}`, false, error)
      }
      // Fell through the last provider.
      break
    }
  }

  const reason = lastClass?.reason ?? 'unknown'
  const message = lastError instanceof Error ? lastError.message : String(lastError)
  throw new ReviewError(
    `All AI providers failed (last: ${reason}): ${message}`,
    lastClass?.retryable ?? true,
    lastError,
  )
}
