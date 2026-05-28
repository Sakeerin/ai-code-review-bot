import type { Context, Next } from 'hono'
import type { AppEnv } from './verify-signature.js'

/**
 * HMAC-SHA256 signature verification for Bitbucket Cloud webhooks.
 * Bitbucket sends the digest in `X-Hub-Signature` as `sha256=<hex>`.
 */
export async function verifyBitbucketSignature(
  c: Context<AppEnv>,
  next: Next,
): Promise<Response | void> {
  const signature = c.req.header('X-Hub-Signature')
  const secret = c.env.BITBUCKET_WEBHOOK_SECRET

  // If no secret is configured, skip verification (useful in dev)
  if (!secret) {
    const body = await c.req.text()
    c.set('rawBody', body)
    return next()
  }

  if (!signature) {
    return c.json({ error: 'Missing X-Hub-Signature header' }, 401)
  }

  const body = await c.req.text()

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(body))

  const expected =
    'sha256=' +
    Array.from(new Uint8Array(signatureBytes))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

  if (!timingSafeEqual(signature, expected)) {
    console.error('Bitbucket webhook signature verification failed')
    return c.json({ error: 'Invalid signature' }, 401)
  }

  c.set('rawBody', body)
  return next()
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const enc = new TextEncoder()
  const aBytes = enc.encode(a)
  const bBytes = enc.encode(b)
  let result = 0
  for (let i = 0; i < aBytes.length; i++) {
    result |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0)
  }
  return result === 0
}
