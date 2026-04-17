import type { Context, Next } from 'hono'
import type { Env } from '../types.js'

export type GitLabAppEnv = {
  Bindings: Env
  Variables: { rawBody: string }
}

export async function verifyGitLabSignature(
  c: Context<GitLabAppEnv>,
  next: Next,
): Promise<Response | void> {
  const token = c.req.header('X-Gitlab-Token')

  if (!token) {
    return c.json({ error: 'Missing X-Gitlab-Token header' }, 401)
  }

  // Timing-safe comparison
  if (!timingSafeEqual(token, c.env.GITLAB_WEBHOOK_SECRET)) {
    console.error('⚠️ GitLab webhook token verification failed')
    return c.json({ error: 'Invalid GitLab webhook token' }, 401)
  }

  const body = await c.req.text()
  c.set('rawBody', body)

  await next()
}

/**
 * Timing-safe string comparison to prevent timing attacks.
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
