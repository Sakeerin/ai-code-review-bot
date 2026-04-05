import type { Context, Next } from 'hono'
import type { Env } from '../types.js'

/** App-level type for Hono context with env bindings and variables */
export type AppEnv = {
  Bindings: Env
  Variables: { rawBody: string }
}

/**
 * HMAC-SHA256 signature verification middleware for GitHub webhooks.
 *
 * GitHub sends the HMAC signature in the `X-Hub-Signature-256` header
 * as `sha256=<hex_digest>`. This middleware:
 *
 * 1. Reads the raw request body
 * 2. Computes HMAC-SHA256 using the webhook secret
 * 3. Compares with the provided signature using timing-safe comparison
 * 4. Returns 401 if invalid, otherwise continues to next handler
 */
export async function verifyGitHubSignature(
  c: Context<AppEnv>,
  next: Next,
): Promise<Response | void> {
  const signature = c.req.header('X-Hub-Signature-256')

  if (!signature) {
    return c.json({ error: 'Missing X-Hub-Signature-256 header' }, 401)
  }

  const body = await c.req.text()
  const secret = c.env.GITHUB_WEBHOOK_SECRET

  // Compute expected HMAC
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signatureBytes = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(body),
  )

  const expectedSignature =
    'sha256=' +
    Array.from(new Uint8Array(signatureBytes))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

  // Timing-safe comparison
  if (!timingSafeEqual(signature, expectedSignature)) {
    console.error('⚠️ Webhook signature verification failed')
    return c.json({ error: 'Invalid signature' }, 401)
  }

  // Store raw body for later use (since we already consumed it)
  c.set('rawBody', body)

  await next()
}

/**
 * Timing-safe string comparison to prevent timing attacks.
 * Uses Web Crypto API's subtle.timingSafeEqual when available,
 * falls back to constant-time byte comparison.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false
  }

  const encoder = new TextEncoder()
  const aBytes = encoder.encode(a)
  const bBytes = encoder.encode(b)

  let result = 0
  for (let i = 0; i < aBytes.length; i++) {
    result |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0)
  }

  return result === 0
}
