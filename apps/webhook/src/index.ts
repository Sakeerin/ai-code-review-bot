import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { verifyGitHubSignature, type AppEnv } from './middleware/verify-signature.js'
import { verifyGitLabSignature } from './middleware/verify-gitlab-signature.js'
import { handlePullRequest } from './handlers/pull-request.js'
import { handleInstallation } from './handlers/installation.js'
import { handleMergeRequest } from './handlers/merge-request.js'
import { rateLimit } from './middleware/rate-limit.js'
import * as Sentry from '@sentry/cloudflare'

// ─── App Setup ──────────────────────────────────────────────────

const app = new Hono<AppEnv>()

// ─── Global Middleware ──────────────────────────────────────────

app.use('*', logger())
app.use('*', cors())

// ─── Health Check ───────────────────────────────────────────────

app.get('/', (c) => {
  return c.json({
    name: 'AI Review Bot — Webhook Service',
    version: '0.1.0',
    status: 'healthy',
    timestamp: new Date().toISOString(),
  })
})

app.get('/health', (c) => {
  return c.json({ status: 'ok' })
})

// ─── GitHub Webhook Endpoint ────────────────────────────────────

app.post('/webhook/github', verifyGitHubSignature, rateLimit, async (c) => {
  const event = c.req.header('X-GitHub-Event') ?? 'unknown'

  console.log(`📩 Received GitHub event: ${event}`)

  switch (event) {
    case 'pull_request':
      return handlePullRequest(c)

    case 'installation':
      return handleInstallation(c)

    case 'ping':
      console.log('🏓 Ping received — webhook is configured correctly!')
      return c.json({ status: 'pong' })

    default:
      console.log(`⏭️ Ignoring unhandled event: ${event}`)
      return c.json({
        status: 'ignored',
        event,
        message: `Event "${event}" is not handled`,
      })
  }
})

app.post('/webhook/gitlab', verifyGitLabSignature, rateLimit, async (c) => {
  const event = c.req.header('X-Gitlab-Event') ?? 'unknown'

  console.log(`Received GitLab event: ${event}`)

  switch (event) {
    case 'Merge Request Hook':
      return handleMergeRequest(c)

    case 'Ping':
      return c.json({ status: 'pong' })

    default:
      return c.json({
        status: 'ignored',
        event,
        message: `Event "${event}" is not handled`,
      })
  }
})

// ─── 404 Handler ────────────────────────────────────────────────

app.notFound((c) => {
  return c.json({ error: 'Not Found' }, 404)
})

// ─── Error Handler ──────────────────────────────────────────────

app.onError((err, c) => {
  console.error('❌ Unhandled error:', err)
  return c.json(
    {
      error: 'Internal Server Error',
      message: c.env.ENVIRONMENT === 'production' ? undefined : err.message,
    },
    500,
  )
})

// ─── Export ─────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: AppEnv['Bindings'], ctx: ExecutionContext): Promise<Response> {
    return Sentry.withSentry(
      {
        dsn: env.SENTRY_DSN,
        environment: env.ENVIRONMENT,
      },
      () => app.fetch(request, env, ctx)
    )
  }
}
