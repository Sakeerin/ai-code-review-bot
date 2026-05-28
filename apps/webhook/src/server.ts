/**
 * Bun/Node.js server entry point for self-hosted Docker deployment.
 * Uses an in-memory TTL cache in place of Cloudflare KV.
 * Run with: bun run src/server.ts
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { verifyGitHubSignature, type AppEnv } from './middleware/verify-signature.js'
import { verifyGitLabSignature } from './middleware/verify-gitlab-signature.js'
import { verifyBitbucketSignature } from './middleware/verify-bitbucket-signature.js'
import { handlePullRequest } from './handlers/pull-request.js'
import { handleInstallation } from './handlers/installation.js'
import { handleMergeRequest } from './handlers/merge-request.js'
import { handleBitbucketPR } from './handlers/bitbucket-pr.js'
import { rateLimit } from './middleware/rate-limit.js'
import type { Env } from './types.js'

// Simple in-memory TTL cache that satisfies the KVNamespace interface
function createMemoryKV() {
  const store = new Map<string, { value: string; expiresAt: number }>()
  return {
    async get<T>(key: string, type?: string): Promise<T | null> {
      const entry = store.get(key)
      if (!entry) return null
      if (Date.now() > entry.expiresAt) { store.delete(key); return null }
      return (type === 'json' ? JSON.parse(entry.value) : entry.value) as T
    },
    async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
      const ttlMs = (opts?.expirationTtl ?? 3600) * 1000
      store.set(key, { value, expiresAt: Date.now() + ttlMs })
    },
    async delete(key: string): Promise<void> { store.delete(key) },
  }
}

const bindings = {
  GITHUB_APP_ID: process.env.GITHUB_APP_ID ?? '',
  GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY ?? '',
  GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET ?? '',
  GITLAB_WEBHOOK_SECRET: process.env.GITLAB_WEBHOOK_SECRET ?? '',
  GITLAB_TOKEN: process.env.GITLAB_TOKEN ?? '',
  GITLAB_API_URL: process.env.GITLAB_API_URL ?? 'https://gitlab.com/api/v4',
  BITBUCKET_WEBHOOK_SECRET: process.env.BITBUCKET_WEBHOOK_SECRET ?? '',
  BITBUCKET_USERNAME: process.env.BITBUCKET_USERNAME ?? '',
  BITBUCKET_APP_PASSWORD: process.env.BITBUCKET_APP_PASSWORD ?? '',
  TRIGGER_SECRET_KEY: process.env.TRIGGER_SECRET_KEY ?? '',
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  RATE_LIMIT_KV: createMemoryKV() as unknown as Env['RATE_LIMIT_KV'],
  SENTRY_DSN: process.env.SENTRY_DSN ?? '',
  ENVIRONMENT: process.env.ENVIRONMENT ?? 'production',
} satisfies Env

const app = new Hono<AppEnv>()

app.use('*', logger())
app.use('*', cors())

app.get('/', (c) => c.json({
  name: 'AI Review Bot — Webhook Service (Self-Hosted)',
  version: '0.1.0',
  status: 'healthy',
  timestamp: new Date().toISOString(),
}))

app.get('/health', (c) => c.json({ status: 'ok' }))

app.post('/webhook/github', verifyGitHubSignature, rateLimit, async (c) => {
  const event = c.req.header('X-GitHub-Event') ?? 'unknown'
  switch (event) {
    case 'pull_request': return handlePullRequest(c)
    case 'installation': return handleInstallation(c)
    case 'ping': return c.json({ status: 'pong' })
    default: return c.json({ status: 'ignored', event })
  }
})

app.post('/webhook/gitlab', verifyGitLabSignature, rateLimit, async (c) => {
  const event = c.req.header('X-Gitlab-Event') ?? 'unknown'
  switch (event) {
    case 'Merge Request Hook': return handleMergeRequest(c)
    case 'Ping': return c.json({ status: 'pong' })
    default: return c.json({ status: 'ignored', event })
  }
})

app.post('/webhook/bitbucket', verifyBitbucketSignature, rateLimit, async (c) => {
  const event = c.req.header('X-Event-Key') ?? 'unknown'
  switch (event) {
    case 'pullrequest:created':
    case 'pullrequest:updated': return handleBitbucketPR(c)
    default: return c.json({ status: 'ignored', event })
  }
})

app.notFound((c) => c.json({ error: 'Not Found' }, 404))
app.onError((err, c) => {
  console.error('Unhandled error:', err)
  return c.json({ error: 'Internal Server Error' }, 500)
})

const port = parseInt(process.env.PORT ?? '3000', 10)
console.log(`Webhook server running on port ${port}`)

export default {
  port,
  fetch: (req: Request) => app.fetch(req, bindings),
}
