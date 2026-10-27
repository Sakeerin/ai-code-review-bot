import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import * as schema from '../packages/db/src/schema'
import { eq } from 'drizzle-orm'
import { GitHubClient } from '../packages/github/src/client'

const root = resolve(import.meta.dir, '..')
const pg = new PGlite()
const db = drizzle(pg, { schema })
const journal = JSON.parse(
  await readFile(join(root, 'packages/db/drizzle/meta/_journal.json'), 'utf8'),
)
for (const entry of journal.entries) {
  await pg.exec(await readFile(join(root, 'packages/db/drizzle', `${entry.tag}.sql`), 'utf8'))
}

// Run the real routes, SQL and task bodies; only external service boundaries are replaced.
mock.module(join(root, 'packages/db/src/client.ts'), () => ({ db, createDb: () => db }))
let databaseUnavailable = false
mock.module('postgres', () => ({
  default: () => {
    const queryFor =
      (connection: { query: typeof pg.query }) =>
      async (parts: TemplateStringsArray, ...values: unknown[]) => {
        if (databaseUnavailable) throw new Error('Simulated database outage')
        const query = parts.reduce(
          (text, part, index) => text + (index ? `$${index}` : '') + part,
          '',
        )
        return (await connection.query(query, values)).rows
      }
    const sql = queryFor(pg)
    sql.begin = (callback: (tx: ReturnType<typeof queryFor>) => Promise<unknown>) =>
      pg.transaction((tx) => callback(queryFor(tx)))
    sql.end = async () => {}
    return sql
  },
}))

let installation = {
  app_id: 123,
  target_type: 'User',
  suspended_at: null,
  account: { id: 42, login: 'owner' },
}
let githubUser = { id: 42 }
let membership = { state: 'active', role: 'admin' }
let lookupStatus = 200
let remoteReviews: string[] = []
let remoteComments: string[] = []
let losePublishAcknowledgement = false
let currentHead = 'abc123'
const octokit = {
  rest: {
    pulls: {
      get: async () => ({
        data: {
          number: 1,
          title: 'Change',
          user: { login: 'author' },
          base: { ref: 'main' },
          head: { ref: 'feature', sha: currentHead },
        },
      }),
      listFiles: async () => ({
        data: [
          {
            filename: 'index.ts',
            status: 'modified',
            additions: 1,
            deletions: 1,
            patch: '@@ -1 +1 @@\n-old\n+new',
          },
        ],
      }),
      createReview: async ({ body }: { body: string }) => {
        remoteReviews.push(body)
        if (losePublishAcknowledgement) {
          losePublishAcknowledgement = false
          throw new Error('Response lost after GitHub accepted review')
        }
        return { data: { id: remoteReviews.length } }
      },
      listReviews: () => {},
    },
    issues: {
      createComment: async ({ body }: { body: string }) => {
        remoteComments.push(body)
      },
      listComments: () => {},
    },
    repos: {
      getContent: async () => {
        throw new Error('No config')
      },
    },
  },
  paginate: {
    async *iterator(method: unknown) {
      const bodies = method === octokit.rest.pulls.listReviews ? remoteReviews : remoteComments
      yield { data: bodies.map((body) => ({ body })) }
    },
  },
}
mock.module(join(root, 'packages/github/src/index.ts'), () => ({
  GitHubClient,
  createInstallationOctokit: async () => octokit,
  createAppOctokit: () => ({
    rest: { apps: { getInstallation: async () => ({ data: installation }) } },
  }),
}))
let dispatched: Array<{ id: string; payload: unknown; options: unknown }> = []
let dispatchTokens: string[] = []
for (const workspace of ['packages/queue', 'apps/webhook'])
  mock.module(Bun.resolveSync('@trigger.dev/sdk/v3', join(root, workspace)), () => ({
    task: (definition: unknown) => definition,
    auth: {
      withAuth: async (config: { accessToken: string }, callback: () => Promise<unknown>) => {
        dispatchTokens.push(config.accessToken)
        return callback()
      },
    },
    tasks: {
      trigger: async (id: string, payload: unknown, options: unknown) => {
        dispatched.push({ id, payload, options })
      },
    },
  }))
const ai = await import('../packages/ai/src/index')
let aiCalls = 0
let aiComments = [{ file: 'index.ts', line: 1, severity: 'bug', message: 'Example defect' }]
mock.module(join(root, 'packages/ai/src/index.ts'), () => ({
  ...ai,
  reviewDiff: async () => {
    aiCalls++
    return { comments: aiComments, summary: 'Review', score: 80, tokensInput: 10, tokensOutput: 5 }
  },
}))

mock.module(Bun.resolveSync('next/headers', join(root, 'apps/dashboard')), () => ({
  headers: async () => new Headers(),
}))
mock.module(join(root, 'packages/db/src/auth.ts'), () => ({
  auth: {
    api: {
      getSession: async () => ({ user: { id: 'signed-in-user', email: 'local@example.invalid' } }),
      getAccessToken: async () => ({ accessToken: 'test-oauth-token' }),
    },
  },
}))
globalThis.React = await import(Bun.resolveSync('react', join(root, 'apps/dashboard')))
const originalFetch = globalThis.fetch
let providerBodies: string[] = []
let inlineAttempts = 0
let failInlineAttempt = 0
let slackRequests: RequestInit[] = []
let slackAvailable = true
let meterAvailable = true
let meterRequests: Array<{ payload: string; idempotencyKey: string | null }> = []
globalThis.fetch = async (input, init) => {
  const url = String(input)
  if (url === 'https://api.stripe.com/v1/billing/meter_events') {
    meterRequests.push({
      payload: String(init?.body),
      idempotencyKey: new Headers(init?.headers).get('Idempotency-Key'),
    })
    return Response.json(
      meterAvailable ? { object: 'billing.meter_event' } : { error: { message: 'Unavailable' } },
      { status: meterAvailable ? 200 : 503 },
    )
  }
  if (url.startsWith('https://hooks.slack.com/services/')) {
    slackRequests.push(init ?? {})
    return new Response(slackAvailable ? 'ok' : 'unavailable', {
      status: slackAvailable ? 200 : 503,
    })
  }
  if (url === 'https://api.github.com/user')
    return Response.json(githubUser, { status: lookupStatus })
  if (url.startsWith('https://api.github.com/user/memberships/orgs/'))
    return Response.json(membership, { status: lookupStatus })
  const patch = '@@ -1 +1 @@\n-old\n+new'
  if (url.startsWith('https://gitlab.com/api/v4/')) {
    if (url.includes('/repository/files/')) return new Response('', { status: 404 })
    if (url.endsWith('/changes'))
      return Response.json({
        changes: [{ old_path: 'index.ts', new_path: 'index.ts', diff: patch, deleted_file: false }],
      })
    if (init?.method === 'POST') {
      const payload = JSON.parse(String(init.body))
      if (url.endsWith('/discussions') && ++inlineAttempts === failInlineAttempt)
        return new Response('Transient error', { status: 503 })
      providerBodies.push(payload.body)
      return Response.json({ id: providerBodies.length })
    }
    if (url.includes('/notes?')) return Response.json(providerBodies.map((body) => ({ body })))
    return Response.json({
      iid: 1,
      title: 'Change',
      web_url: 'https://gitlab.com/shared/team/-/merge_requests/1',
      source_branch: 'feature',
      target_branch: 'main',
      author: { username: 'author' },
      diff_refs: { head_sha: 'abc123', base_sha: 'base', start_sha: 'start' },
    })
  }
  if (url.startsWith('https://api.bitbucket.org/2.0/')) {
    if (url.includes('/src/')) return new Response('', { status: 404 })
    if (url.endsWith('/diff'))
      return new Response(
        `diff --git a/index.ts b/index.ts\n--- a/index.ts\n+++ b/index.ts\n${patch}`,
      )
    if (url.endsWith('/diffstat'))
      return Response.json({
        values: [
          {
            status: 'modified',
            new: { path: 'index.ts' },
            old: { path: 'index.ts' },
            lines_added: 1,
            lines_removed: 1,
          },
        ],
      })
    if (init?.method === 'POST') {
      const payload = JSON.parse(String(init.body))
      if (payload.inline && ++inlineAttempts === failInlineAttempt)
        return new Response('Transient error', { status: 503 })
      providerBodies.push(payload.content.raw)
      return Response.json({ id: providerBodies.length })
    }
    if (url.includes('/comments?'))
      return Response.json({ values: providerBodies.map((raw) => ({ content: { raw } })) })
    return Response.json({ source: { commit: { hash: 'abc123' } } })
  }
  throw new Error(`Unexpected outbound request in regression test: ${url}`)
}
process.env.GITHUB_APP_ID = '123'
process.env.GITHUB_APP_PRIVATE_KEY = 'test-private-key'
process.env.STRIPE_SECRET_KEY = 'sk_test_local'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_local'
process.env.STRIPE_METER_EVENT_NAME = ''
process.env.SLACK_WEBHOOK_URL = ''
process.env.STRIPE_TEAM_PRICE_ID = 'price_team'
process.env.STRIPE_TEAM_ANNUAL_PRICE_ID = 'price_team_annual'
process.env.STRIPE_BUSINESS_PRICE_ID = 'price_business'
process.env.STRIPE_BUSINESS_ANNUAL_PRICE_ID = 'price_business_annual'
process.env.STRIPE_OVERAGE_PRICE_ID = 'price_overage'
const stripeLib = await import('../apps/dashboard/src/lib/stripe')
const realStripe = stripeLib.createStripe()
let subscriptionStatus = 'active'
let subscriptionPrice = 'price_team'
let subscriptionRetrievalFails = false
let createdCheckouts: Record<string, unknown>[] = []
let openCheckouts: Record<string, unknown>[] = []
let existingSubscriptions: Record<string, unknown>[] = []
const fakeStripe = {
  webhooks: realStripe.webhooks,
  subscriptions: {
    retrieve: async (id: string) => {
      if (subscriptionRetrievalFails) throw new Error('Stripe unavailable')
      return {
        id,
        customer: 'cus_local',
        status: subscriptionStatus,
        items: { data: [{ price: { id: subscriptionPrice } }] },
      }
    },
    list: async () => ({ data: existingSubscriptions }),
  },
  customers: { create: async () => ({ id: 'cus_local' }) },
  prices: {
    retrieve: async () => ({
      active: true,
      currency: 'usd',
      unit_amount: 5,
      billing_scheme: 'per_unit',
      recurring: {
        usage_type: 'metered',
        interval: 'month',
        interval_count: 1,
        meter: 'mtr_local',
      },
    }),
  },
  billing: { meters: { retrieve: async () => ({ status: 'active', event_name: 'pr_review' }) } },
  checkout: {
    sessions: {
      list: async () => ({ data: openCheckouts }),
      create: async (params: Record<string, unknown>) => {
        createdCheckouts.push(params)
        const checkout = { ...params, url: 'https://checkout.stripe.com/local' }
        openCheckouts.push(checkout)
        return checkout
      },
    },
  },
}
mock.module('@/lib/stripe', () => ({ ...stripeLib, createStripe: () => fakeStripe }))
const billingLib = await import('../apps/dashboard/src/lib/billing')
mock.module('@/lib/billing', () => billingLib)
const orgLib = await import('../apps/dashboard/src/lib/org')
mock.module('@/lib/org', () => orgLib)
const installationLib = await import('../apps/dashboard/src/lib/github-installation')
mock.module('@/lib/github-installation', () => installationLib)
const { POST: stripeWebhook } = await import('../apps/dashboard/src/app/api/webhooks/stripe/route')
const { POST: stripeCheckout } = await import('../apps/dashboard/src/app/api/stripe/checkout/route')
const { default: setupPage } = await import('../apps/dashboard/src/app/dashboard/setup/page')
const { verifyInstallationOwner } = await import('../apps/dashboard/src/lib/github-installation')
const { app, default: worker } = await import('../apps/webhook/src/index')
const { reviewPRTask } = await import('../packages/queue/src/tasks/review-pr')
const { reviewMergeRequestTask } = await import('../packages/queue/src/tasks/review-merge-request')
const { reviewBitbucketPRTask } = await import('../packages/queue/src/tasks/review-bitbucket-pr')
const { upsertGitLabRepo } = await import('../packages/queue/src/lib/save-review')
const { upsertBitbucketRepo } = await import('../packages/queue/src/lib/repository')
const { releaseReviewReservation } = await import('../packages/queue/src/lib/review-reservation')
const { saveReviewAndNotify } = await import('../packages/queue/src/lib/save-review')
const { drainNotificationOutbox } = await import('../packages/queue/src/lib/notification-outbox')
const { isSlackWebhookUrl } = await import('../packages/db/src/webhook-url')
const { sendSlackReviewNotification } = await import('../packages/queue/src/lib/slack')

beforeEach(async () => {
  await pg.exec(
    'TRUNCATE organizations, "user", stripe_webhook_events, rate_limits, review_reservations CASCADE',
  )
  await db.insert(schema.user).values({
    id: 'signed-in-user',
    name: 'Local',
    email: 'local@example.invalid',
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  installation = {
    app_id: 123,
    target_type: 'User',
    suspended_at: null,
    account: { id: 42, login: 'owner' },
  }
  githubUser = { id: 42 }
  membership = { state: 'active', role: 'admin' }
  lookupStatus = 200
  remoteReviews = []
  remoteComments = []
  dispatched = []
  dispatchTokens = []
  aiCalls = 0
  aiComments = [{ file: 'index.ts', line: 1, severity: 'bug', message: 'Example defect' }]
  providerBodies = []
  inlineAttempts = 0
  failInlineAttempt = 0
  databaseUnavailable = false
  losePublishAcknowledgement = false
  currentHead = 'abc123'
  subscriptionStatus = 'active'
  subscriptionPrice = 'price_team'
  subscriptionRetrievalFails = false
  createdCheckouts = []
  openCheckouts = []
  existingSubscriptions = []
  slackRequests = []
  slackAvailable = true
  meterAvailable = true
  meterRequests = []
  process.env.SLACK_WEBHOOK_URL = ''
  process.env.STRIPE_METER_EVENT_NAME = 'pr_review'
})
afterAll(async () => {
  globalThis.fetch = originalFetch
  await pg.close()
})

async function githubRepo(plan: 'free' | 'team' | 'business' = 'free', active = true) {
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: 'shared', githubInstallationId: '123', plan })
    .returning()
  const [repo] = await db
    .insert(schema.repositories)
    .values({
      orgId: org.id,
      provider: 'github',
      githubRepoId: '456',
      fullName: 'shared/team',
      isActive: active,
    })
    .returning()
  return { org, repo }
}
const bindings = {
  DATABASE_URL: 'local-test-only',
  ENVIRONMENT: 'test',
  GITHUB_WEBHOOK_SECRET: 'test-secret',
  BITBUCKET_WEBHOOK_SECRET: 'test-secret',
  GITLAB_WEBHOOK_SECRET: 'test-secret',
  SENTRY_DSN: '',
  TRIGGER_SECRET_KEY: 'tr_test_local',
  RATE_LIMIT_KV: {},
}
const ghPayload = () => ({
  action: 'opened',
  installation: { id: 123 },
  repository: { id: 456, full_name: 'shared/team' },
  pull_request: {
    number: 1,
    title: 'Change',
    user: { login: 'author' },
    head: { sha: 'abc123', ref: 'feature' },
  },
})
const bbPayload = () => ({
  repository: { full_name: 'shared/team' },
  actor: { nickname: 'author' },
  pullrequest: {
    id: 1,
    title: 'Change',
    source: {
      commit: { hash: 'abc123' },
      branch: { name: 'feature' },
      repository: { full_name: 'shared/team' },
    },
    destination: { branch: { name: 'main' }, repository: { full_name: 'shared/team' } },
    links: { html: { href: 'https://bitbucket.org/shared/team/pull-requests/1' } },
  },
})
async function webhook(
  provider: 'github' | 'gitlab' | 'bitbucket',
  payload: unknown,
  extra: Record<string, string> = {},
  env = bindings,
) {
  const body = JSON.stringify(payload)
  const signature = `sha256=${createHmac('sha256', 'test-secret').update(body).digest('hex')}`
  const headers =
    provider === 'github'
      ? { 'X-GitHub-Event': 'pull_request', 'X-Hub-Signature-256': signature }
      : provider === 'bitbucket'
        ? { 'X-Event-Key': 'pullrequest:created', 'X-Hub-Signature': signature }
        : { 'X-Gitlab-Event': 'Merge Request Hook', 'X-Gitlab-Token': 'test-secret' }
  return app.fetch(
    new Request(`https://test.invalid/webhook/${provider}`, {
      method: 'POST',
      headers: { ...headers, ...extra },
      body,
    }),
    env,
  )
}
async function stripeEvent(id = 'evt_local') {
  const org = await db.query.organizations.findFirst()
  const body = JSON.stringify({
    id,
    type: 'checkout.session.completed',
    data: {
      object: {
        client_reference_id: org?.id,
        customer: 'cus_local',
        subscription: 'sub_local',
        metadata: { plan: 'team' },
      },
    },
  })
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = `t=${timestamp},v1=${createHmac('sha256', 'whsec_local').update(`${timestamp}.${body}`).digest('hex')}`
  return stripeWebhook(
    new Request('https://test.invalid/api/webhooks/stripe', {
      method: 'POST',
      body,
      headers: { 'stripe-signature': signature },
    }),
  )
}
const taskPayload = () => ({
  installationId: 123,
  githubRepoId: 456,
  repoFullName: 'shared/team',
  prNumber: 1,
  prTitle: 'Change',
  prAuthor: 'author',
  headSha: 'abc123',
})
const attempt = (number = 1) => ({ ctx: { attempt: { number } } })

describe('GitHub installation authorization', () => {
  test('rejects an unrelated account before creating an organization or owner membership', async () => {
    githubUser = { id: 999 }
    await expect(
      setupPage({ searchParams: Promise.resolve({ installation_id: '123' }) }),
    ).rejects.toThrow()
    expect(await db.select().from(schema.organizations)).toHaveLength(0)
    expect(await db.select().from(schema.userOrganizations)).toHaveLength(0)
  })
  test('links a verified personal installation owner', async () => {
    await setupPage({ searchParams: Promise.resolve({ installation_id: '123' }) })
    const memberships = await db.select().from(schema.userOrganizations)
    expect(memberships).toHaveLength(1)
    expect(memberships[0].role).toBe('owner')
  })
  test('requires active organization admin membership', async () => {
    installation.target_type = 'Organization'
    membership.role = 'member'
    expect(await verifyInstallationOwner('token', 123)).toBeNull()
    membership.role = 'admin'
    membership.state = 'pending'
    expect(await verifyInstallationOwner('token', 123)).toBeNull()
    membership.state = 'active'
    expect(await verifyInstallationOwner('token', 123)).toEqual({ login: 'owner' })
  })
  test('fails closed when GitHub denies the token or installation belongs to another app', async () => {
    lookupStatus = 403
    expect(await verifyInstallationOwner('token', 123)).toBeNull()
    lookupStatus = 200
    installation.app_id = 999
    expect(await verifyInstallationOwner('token', 123)).toBeNull()
  })
  test('rejects malformed installation IDs without mutations', async () => {
    for (const value of ['-1', '0', 'not-an-id', '999999999999999999999']) {
      await expect(
        setupPage({ searchParams: Promise.resolve({ installation_id: value }) }),
      ).rejects.toThrow()
    }
    expect(await db.select().from(schema.organizations)).toHaveLength(0)
  })
})

describe('Webhook signatures and authoritative quotas', () => {
  test('Cloudflare handler returns a real response', async () => {
    const background: Promise<unknown>[] = []
    const response = await worker.fetch(new Request('https://test.invalid/health'), bindings, {
      waitUntil: (p: Promise<unknown>) => background.push(p),
      passThroughOnException() {},
    })
    expect(response).toBeInstanceOf(Response)
    expect(response.status).toBe(200)
    await Promise.allSettled(background)
  })
  test('rejects missing Bitbucket configuration even in production', async () => {
    const response = await webhook(
      'bitbucket',
      bbPayload(),
      {},
      { ...bindings, ENVIRONMENT: 'production', BITBUCKET_WEBHOOK_SECRET: '' },
    )
    expect(response.status).toBe(503)
    expect(dispatched).toHaveLength(0)
  })
  test('rejects missing or forged signatures', async () => {
    expect((await webhook('bitbucket', bbPayload(), { 'X-Hub-Signature': '' })).status).toBe(401)
    expect(
      (await webhook('bitbucket', bbPayload(), { 'X-Hub-Signature': 'sha256=invalid' })).status,
    ).toBe(401)
    expect(dispatched).toHaveLength(0)
  })
  test('enforces Bitbucket free quota and ignores spoofed provider headers', async () => {
    await upsertBitbucketRepo(db, 'shared', 'shared/team')
    await db
      .insert(schema.rateLimits)
      .values({ orgKey: 'bb:shared', monthKey: new Date().toISOString().slice(0, 7), used: 50 })
    expect((await webhook('bitbucket', bbPayload(), { 'X-GitHub-Event': 'ping' })).status).toBe(429)
    expect(dispatched).toHaveLength(0)
  })
  test('applies upgrades and downgrades immediately during the same month', async () => {
    const { org } = await githubRepo()
    await db.insert(schema.rateLimits).values({
      orgKey: 'gh:123',
      monthKey: new Date().toISOString().slice(0, 7),
      used: 50,
      plan: 'free',
    })
    expect((await webhook('github', ghPayload())).status).toBe(429)
    await db
      .update(schema.organizations)
      .set({ plan: 'team' })
      .where(eq(schema.organizations.id, org.id))
    expect((await webhook('github', ghPayload())).status).toBe(200)
    expect((await db.query.rateLimits.findFirst())?.plan).toBe('team')
    await db
      .update(schema.organizations)
      .set({ plan: 'free' })
      .where(eq(schema.organizations.id, org.id))
    const newCommit = ghPayload()
    newCommit.pull_request.head.sha = 'next-commit'
    expect((await webhook('github', newCommit)).status).toBe(429)
  })
  test('does not dispatch or consume quota for an inactive repository', async () => {
    await githubRepo('free', false)
    expect((await webhook('github', ghPayload())).status).toBe(200)
    expect(dispatched).toHaveLength(0)
    expect(await db.select().from(schema.rateLimits)).toHaveLength(0)
  })
  test('fails closed on database outages', async () => {
    databaseUnavailable = true
    expect((await webhook('github', ghPayload())).status).toBe(503)
    expect(dispatched).toHaveLength(0)
  })
  test('passes commit idempotency and PR concurrency keys when dispatching', async () => {
    await githubRepo()
    expect((await webhook('github', ghPayload())).status).toBe(200)
    expect(dispatched[0].options).toEqual({
      concurrencyKey: 'github:123:456:1',
      idempotencyKey: 'github:123:456:1:abc123',
    })
    expect(dispatchTokens).toEqual(['tr_test_local'])
  })
})

describe('Quota reservations and billing', () => {
  test('duplicate and concurrent deliveries reserve only one quota slot', async () => {
    await githubRepo()
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => webhook('github', ghPayload())),
    )
    expect(responses.every((response) => response.status === 200)).toBe(true)
    expect((await db.query.rateLimits.findFirst())?.used).toBe(1)
    expect(await db.select().from(schema.reviewReservations)).toHaveLength(1)
  })
  test('only one new commit can take the final free slot', async () => {
    await githubRepo()
    await db
      .insert(schema.rateLimits)
      .values({ orgKey: 'gh:123', monthKey: new Date().toISOString().slice(0, 7), used: 49 })
    const responses = await Promise.all(
      ['a', 'b'].map((sha) => {
        const payload = ghPayload()
        payload.pull_request.head.sha = sha
        return webhook('github', payload)
      }),
    )
    expect(responses.map((response) => response.status).sort()).toEqual([200, 429])
    expect((await db.query.rateLimits.findFirst())?.used).toBe(50)
  })
  test('superseded and exhausted failures release once; completed replays keep their slot', async () => {
    await githubRepo()
    await webhook('github', ghPayload())
    const reservation = await db.query.reviewReservations.findFirst()
    const payload = { ...taskPayload(), reservationKey: reservation!.reservationKey }
    currentHead = 'new-head'
    await reviewPRTask.run(payload, attempt())
    await releaseReviewReservation(db, payload.reservationKey)
    expect((await db.query.rateLimits.findFirst())?.used).toBe(0)
    const dispatchedBeforeReplay = dispatched.length
    await webhook('github', ghPayload())
    expect(dispatched).toHaveLength(dispatchedBeforeReplay)
    expect((await db.query.rateLimits.findFirst())?.used).toBe(0)
    const nextCommit = ghPayload()
    nextCommit.pull_request.head.sha = currentHead
    await webhook('github', nextCommit)
    const nextReservation = (await db.select().from(schema.reviewReservations)).find(
      (row) => row.status === 'reserved',
    )!
    const nextPayload = {
      ...taskPayload(),
      headSha: currentHead,
      reservationKey: nextReservation.reservationKey,
    }
    await reviewPRTask.run(nextPayload, attempt())
    await reviewPRTask.run(nextPayload, attempt())
    expect((await db.query.rateLimits.findFirst())?.used).toBe(1)
    expect(
      (
        await db.query.reviewReservations.findFirst({
          where: eq(schema.reviewReservations.reservationKey, nextReservation.reservationKey),
        })
      )?.status,
    ).toBe('completed')
    expect((await orgLib.getUsageSummary((await db.query.organizations.findFirst())!)).used).toBe(1)
  })
  test('checkout attaches monthly usage to monthly and annual Team, and reuses an open session', async () => {
    const { org } = await githubRepo()
    await db
      .insert(schema.userOrganizations)
      .values({ userId: 'signed-in-user', orgId: org.id, role: 'owner' })
    const request = (billing: string, plan = 'team') =>
      new Request('https://test.invalid/checkout', {
        method: 'POST',
        body: JSON.stringify({ plan, billing }),
      })
    expect((await stripeCheckout(request('monthly'))).status).toBe(200)
    expect((await stripeCheckout(request('monthly'))).status).toBe(200)
    expect(createdCheckouts).toHaveLength(1)
    expect(createdCheckouts[0].line_items).toEqual([
      { price: 'price_team', quantity: 1 },
      { price: 'price_overage' },
    ])
    expect((await stripeCheckout(request('annual'))).status).toBe(409)
    openCheckouts = []
    expect((await stripeCheckout(request('annual'))).status).toBe(200)
    expect(createdCheckouts[1].line_items).toEqual([
      { price: 'price_team_annual', quantity: 1 },
      { price: 'price_overage' },
    ])
    expect(createdCheckouts[1].subscription_data).toMatchObject({
      billing_mode: { type: 'flexible' },
    })
    openCheckouts = []
    expect((await stripeCheckout(request('annual', 'business'))).status).toBe(200)
    expect(createdCheckouts[2].line_items).toEqual([
      { price: 'price_business_annual', quantity: 1 },
    ])
    existingSubscriptions = [{ status: 'unpaid' }]
    expect((await stripeCheckout(request('monthly'))).status).toBe(409)
  })
  test('revokes unpaid, paused and canceled access using current Stripe state, even for an old event', async () => {
    await githubRepo()
    for (const status of [
      'active',
      'trialing',
      'past_due',
      'unpaid',
      'paused',
      'canceled',
      'incomplete',
    ]) {
      subscriptionStatus = status
      expect((await stripeEvent(`evt_${status}`)).status).toBe(200)
      expect((await db.query.organizations.findFirst())?.plan).toBe(
        ['active', 'trialing', 'past_due'].includes(status) ? 'team' : 'free',
      )
    }
    subscriptionRetrievalFails = true
    expect((await stripeEvent('evt_retry_state')).status).toBe(500)
    expect(
      await db.query.stripeWebhookEvents.findFirst({
        where: eq(schema.stripeWebhookEvents.eventId, 'evt_retry_state'),
      }),
    ).toBeUndefined()
  })
})

describe('Stripe transactional receipts', () => {
  test('rolls back a failed billing update and successfully processes a retry', async () => {
    await githubRepo()
    await pg.exec(
      "CREATE FUNCTION reject_plan_update() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'temporary outage'; END $$ LANGUAGE plpgsql; CREATE TRIGGER reject_plan_update BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION reject_plan_update()",
    )
    try {
      expect((await stripeEvent()).status).toBe(500)
      expect(await db.select().from(schema.stripeWebhookEvents)).toHaveLength(0)
    } finally {
      await pg.exec(
        'DROP TRIGGER reject_plan_update ON organizations; DROP FUNCTION reject_plan_update()',
      )
    }
    expect((await stripeEvent()).status).toBe(200)
    expect((await db.query.organizations.findFirst())?.plan).toBe('team')
    expect(await db.select().from(schema.stripeWebhookEvents)).toHaveLength(1)
    expect((await stripeEvent()).status).toBe(200)
    expect(await db.select().from(schema.stripeWebhookEvents)).toHaveLength(1)
  })
  test('returns 500 for receipt storage errors instead of falsely acknowledging a duplicate', async () => {
    await githubRepo()
    await pg.exec('ALTER TABLE stripe_webhook_events RENAME TO unavailable_receipts')
    try {
      expect((await stripeEvent()).status).toBe(500)
    } finally {
      await pg.exec('ALTER TABLE unavailable_receipts RENAME TO stripe_webhook_events')
    }
  })
})

describe('Configuration and notification delivery', () => {
  test('accepts only official HTTPS Slack webhooks and rejects redirects at delivery', async () => {
    expect(isSlackWebhookUrl('https://hooks.slack.com/services/T123/B456/token')).toBe(true)
    expect(isSlackWebhookUrl('https://hooks.slack-gov.com/services/T123/B456/token')).toBe(true)
    for (const url of [
      'http://hooks.slack.com/services/T/B/token',
      'https://127.0.0.1/services/T/B/token',
      'https://hooks.slack.com.evil.test/services/T/B/token',
      'https://user@hooks.slack.com/services/T/B/token',
      'https://hooks.slack.com:8443/services/T/B/token',
      'https://hooks.slack.com/services/T/B/token?redirect=1',
    ]) {
      expect(isSlackWebhookUrl(url)).toBe(false)
      await expect(sendSlackReviewNotification({} as never, url)).rejects.toThrow()
    }
    await sendSlackReviewNotification(
      {
        provider: 'github',
        repository: 'org/repo',
        reviewNumber: 1,
        title: null,
        author: null,
        score: 80,
        bugsFound: 0,
        commentsPosted: 0,
        reviewUrl: null,
        summary: 'done',
      },
      'https://hooks.slack.com/services/T/B/token',
    )
    expect(slackRequests[0].redirect).toBe('error')
  })
  test('matches nested, root and Windows paths with real glob patterns and bounds config limits', () => {
    expect(ai.isFileIgnored('src/nested/a.test.ts', ['**/*.test.ts'])).toBe(true)
    expect(ai.isFileIgnored('a.test.ts', ['**/*.test.ts'])).toBe(true)
    expect(ai.isFileIgnored('src\\nested\\a.ts', ['src/**'])).toBe(true)
    expect(ai.isFileIgnored('src/main.ts', ['**/*.test.ts', 'dist/**'])).toBe(false)
    for (const value of [-1, 0, 0.5, 100000]) {
      const config = ai.parseReviewBotConfig(
        `limits:\n  max_files_per_pr: ${value}\n  max_file_size_lines: ${value}`,
      )
      expect(config.limits).toEqual({ max_files_per_pr: 20, max_file_size_lines: 500 })
    }
  })
  test('Slack failures survive completion and scheduled retries never repeat AI or delivered messages', async () => {
    await githubRepo()
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/T/B/token'
    slackAvailable = false
    await reviewPRTask.run(taskPayload(), attempt())
    await reviewPRTask.run(taskPayload(), attempt())
    expect(aiCalls).toBe(1)
    expect((await db.query.notificationOutbox.findFirst())?.status).toBe('pending')
    expect(slackRequests).toHaveLength(1)
    slackAvailable = true
    await db.update(schema.notificationOutbox).set({ nextAttemptAt: new Date(0) })
    await drainNotificationOutbox(db)
    await drainNotificationOutbox(db)
    expect(slackRequests).toHaveLength(2)
    expect((await db.query.notificationOutbox.findFirst())?.status).toBe('delivered')
    expect(aiCalls).toBe(1)
  })
  test('only Team completions above 500 create a durable metered overage', async () => {
    const { org, repo } = await githubRepo('team')
    await db
      .update(schema.organizations)
      .set({ stripeCustomerId: 'cus_local' })
      .where(eq(schema.organizations.id, org.id))
    await db.insert(schema.reviews).values(
      Array.from({ length: 499 }, (_, i) => ({
        repoId: repo.id,
        provider: 'github' as const,
        prNumber: i + 10,
        status: 'completed' as const,
        completedAt: new Date(),
      })),
    )
    const save = (reviewKey: string) =>
      saveReviewAndNotify(
        {
          db,
          repoId: repo.id,
          orgId: org.id,
          reviewKey,
          provider: 'github',
          prNumber: 1,
          prTitle: null,
          prAuthor: null,
          reviewUrl: null,
          reviewResult: {
            comments: [],
            summary: 'done',
            score: 80,
            tokensInput: 1,
            tokensOutput: 1,
          },
          persistedComments: [],
          commentsPosted: 0,
          bugsFound: 0,
        },
        {
          provider: 'github',
          repository: 'shared/team',
          reviewNumber: 1,
          title: null,
          author: null,
          reviewUrl: null,
        },
      )
    // Force delivery to remain pending, without contacting the Stripe API.
    process.env.STRIPE_METER_EVENT_NAME = ''
    await save('review-500')
    expect(await db.select().from(schema.notificationOutbox)).toHaveLength(0)
    await save('review-501')
    await save('review-501')
    const [delivery] = await db.select().from(schema.notificationOutbox)
    expect(delivery.kind).toBe('stripe')
    expect(delivery.status).toBe('pending')
    expect(delivery.payload).toMatchObject({ customerId: 'cus_local', reviewKey: 'review-501' })
    process.env.STRIPE_METER_EVENT_NAME = 'pr_review'
    meterAvailable = false
    await db.update(schema.notificationOutbox).set({ nextAttemptAt: new Date(0) })
    await drainNotificationOutbox(db)
    meterAvailable = true
    await db.update(schema.notificationOutbox).set({ nextAttemptAt: new Date(0) })
    await Promise.all([drainNotificationOutbox(db), drainNotificationOutbox(db)])
    expect(meterRequests).toHaveLength(2)
    expect(meterRequests[0]).toEqual(meterRequests[1])
    expect(meterRequests[0].idempotencyKey).toBe('review-501')
    const meterPayload = new URLSearchParams(meterRequests[0].payload)
    expect(meterPayload.get('payload[value]')).toBe('1')
    expect(meterPayload.get('identifier')).toBe('review-501')
    expect((await db.query.notificationOutbox.findFirst())?.status).toBe('delivered')
    await db
      .update(schema.organizations)
      .set({ plan: 'business' })
      .where(eq(schema.organizations.id, org.id))
    await save('review-business')
    expect(await db.select().from(schema.notificationOutbox)).toHaveLength(1)
  })
})

describe('Provider isolation and review retries', () => {
  test('migration preserves existing provider plans without claiming GitHub organizations by name', async () => {
    const legacy = new PGlite()
    try {
      for (const entry of journal.entries.slice(0, 6)) {
        await legacy.exec(
          await readFile(join(root, 'packages/db/drizzle', `${entry.tag}.sql`), 'utf8'),
        )
      }
      const gl = (
        await legacy.query<{ id: string }>(
          "INSERT INTO organizations (name, plan) VALUES ('shared', 'team') RETURNING id",
        )
      ).rows[0]
      const bb = (
        await legacy.query<{ id: string }>(
          "INSERT INTO organizations (name, plan) VALUES ('workspace', 'business') RETURNING id",
        )
      ).rows[0]
      const gh = (
        await legacy.query<{ id: string }>(
          "INSERT INTO organizations (name, plan, github_installation_id) VALUES ('shared', 'business', '123') RETURNING id",
        )
      ).rows[0]
      await legacy.query(
        "INSERT INTO repositories (org_id, provider, gitlab_project_id, full_name) VALUES ($1, 'gitlab', '1', 'shared/repo')",
        [gl.id],
      )
      await legacy.query(
        "INSERT INTO repositories (org_id, provider, bitbucket_repo_id, full_name) VALUES ($1, 'bitbucket', 'workspace/repo', 'workspace/repo')",
        [bb.id],
      )
      await legacy.query(
        "INSERT INTO repositories (org_id, provider, github_repo_id, full_name) VALUES ($1, 'github', '2', 'shared/repo')",
        [gh.id],
      )
      for (const latest of journal.entries.slice(6)) {
        await legacy.exec(
          await readFile(join(root, 'packages/db/drizzle', `${latest.tag}.sql`), 'utf8'),
        )
      }
      expect(
        (
          await legacy.query('SELECT plan, gitlab_namespace FROM organizations WHERE id = $1', [
            gl.id,
          ])
        ).rows[0],
      ).toEqual({ plan: 'team', gitlab_namespace: 'shared' })
      expect(
        (
          await legacy.query('SELECT plan, bitbucket_workspace FROM organizations WHERE id = $1', [
            bb.id,
          ])
        ).rows[0],
      ).toEqual({ plan: 'business', bitbucket_workspace: 'workspace' })
      expect(
        (
          await legacy.query(
            'SELECT gitlab_namespace, bitbucket_workspace FROM organizations WHERE id = $1',
            [gh.id],
          )
        ).rows[0],
      ).toEqual({ gitlab_namespace: null, bitbucket_workspace: null })
    } finally {
      await legacy.close()
    }
  })
  test('keeps same-name GitHub, GitLab and Bitbucket repositories in separate organizations', async () => {
    const { org: githubOrg } = await githubRepo('business')
    const bbRepo = await upsertBitbucketRepo(db, 'shared', 'shared/team')
    const glRepo = await upsertGitLabRepo(db, { projectId: 456, projectPath: 'shared/team' })
    expect(new Set([githubOrg.id, bbRepo.orgId, glRepo.orgId]).size).toBe(3)
    await reviewPRTask.run(taskPayload(), attempt())
    const review = await db.query.reviews.findFirst({ with: { repository: true } })
    expect(review?.repository.orgId).toBe(githubOrg.id)
    expect(review?.repository.provider).toBe('github')
  })
  test('inactive repositories skip AI in all three task entry points', async () => {
    await githubRepo('free', false)
    const bbRepo = await upsertBitbucketRepo(db, 'shared', 'shared/team')
    const glRepo = await upsertGitLabRepo(db, { projectId: 456, projectPath: 'shared/team' })
    for (const repo of [bbRepo, glRepo])
      await db
        .update(schema.repositories)
        .set({ isActive: false })
        .where(eq(schema.repositories.id, repo.id))
    await reviewPRTask.run(taskPayload(), attempt())
    await reviewMergeRequestTask.run(
      { projectId: 456, projectPath: 'shared/team', mergeRequestIid: 1 },
      attempt(),
    )
    await reviewBitbucketPRTask.run({ workspace: 'shared', repoFullName: 'shared/team' }, attempt())
    expect(aiCalls).toBe(0)
    expect(remoteReviews).toHaveLength(0)
  })
  test('reuses AI output and remote review after persistence fails, then ignores completed replays', async () => {
    await githubRepo()
    await pg.exec(
      "CREATE FUNCTION reject_review_comment() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'temporary outage'; END $$ LANGUAGE plpgsql; CREATE TRIGGER reject_review_comment BEFORE INSERT ON review_comments FOR EACH ROW EXECUTE FUNCTION reject_review_comment()",
    )
    try {
      await expect(reviewPRTask.run(taskPayload(), attempt())).rejects.toThrow()
      expect(await db.select().from(schema.reviews)).toHaveLength(0)
      expect(await db.select().from(schema.reviewRuns)).toHaveLength(1)
      expect(remoteReviews).toHaveLength(1)
    } finally {
      await pg.exec(
        'DROP TRIGGER reject_review_comment ON review_comments; DROP FUNCTION reject_review_comment()',
      )
    }
    await reviewPRTask.run(taskPayload(), attempt(2))
    await reviewPRTask.run(taskPayload(), attempt())
    expect(aiCalls).toBe(1)
    expect(remoteReviews).toHaveLength(1)
    expect(await db.select().from(schema.reviews)).toHaveLength(1)
    expect(await db.select().from(schema.reviewComments)).toHaveLength(1)
  })
  test('reconciles a remote write even when its success response was lost', async () => {
    await githubRepo()
    losePublishAcknowledgement = true
    await expect(reviewPRTask.run(taskPayload(), attempt())).rejects.toThrow()
    await reviewPRTask.run(taskPayload(), attempt(2))
    expect(aiCalls).toBe(1)
    expect(remoteReviews).toHaveLength(1)
    expect(await db.select().from(schema.reviews)).toHaveLength(1)
  })
  test('skips superseded commits before calling AI', async () => {
    await githubRepo()
    currentHead = 'newer-commit'
    await reviewPRTask.run(taskPayload(), attempt())
    expect(aiCalls).toBe(0)
    expect(remoteReviews).toHaveLength(0)
  })
  for (const provider of ['gitlab', 'bitbucket'] as const) {
    test(`${provider} resumes after a partial publish without repeating accepted comments or AI`, async () => {
      aiComments.push({
        file: 'index.ts',
        line: 1,
        severity: 'suggestion',
        message: 'Second finding',
      })
      failInlineAttempt = 2
      const run =
        provider === 'gitlab'
          ? (number: number) =>
              reviewMergeRequestTask.run(
                {
                  projectId: 456,
                  projectPath: 'shared/team',
                  mergeRequestIid: 1,
                  mergeRequestTitle: 'Change',
                  mergeRequestAuthor: 'author',
                  headSha: 'abc123',
                },
                attempt(number),
              )
          : (number: number) =>
              reviewBitbucketPRTask.run(
                {
                  workspace: 'shared',
                  repoSlug: 'team',
                  repoFullName: 'shared/team',
                  prId: 1,
                  prTitle: 'Change',
                  prAuthor: 'author',
                  headCommitHash: 'abc123',
                  prUrl: 'https://bitbucket.org/shared/team/pull-requests/1',
                  bitbucketUsername: 'test',
                  bitbucketAppPassword: 'test',
                },
                attempt(number),
              )
      await expect(run(1)).rejects.toThrow()
      expect(providerBodies).toHaveLength(1)
      await run(2)
      await run(1)
      expect(aiCalls).toBe(1)
      expect(providerBodies).toHaveLength(3)
      expect(await db.select().from(schema.reviews)).toHaveLength(1)
      expect(await db.select().from(schema.reviewComments)).toHaveLength(2)
    })
  }
})
