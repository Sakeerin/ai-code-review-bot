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

  if (token !== c.env.GITLAB_WEBHOOK_SECRET) {
    return c.json({ error: 'Invalid GitLab webhook token' }, 401)
  }

  const body = await c.req.text()
  c.set('rawBody', body)

  await next()
}
