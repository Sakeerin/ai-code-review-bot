import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { eq, isNull, sql } from 'drizzle-orm'
import { createDb, type Database } from '../packages/db/src/client'
import * as schema from '../packages/db/src/schema'
import { canActivateRepository } from '../packages/db/src/repository-policy'
import { dispatchReviewJobs } from '../packages/db/src/review-dispatch'
import { saveReviewAndNotify } from '../packages/queue/src/lib/save-review'

// Use an explicit test connection, never the application's DATABASE_URL. Each run
// creates and removes its own database; the supplied role needs CREATEDB rights.
const testUrl = process.env.POSTGRES_TEST_URL
if (!testUrl) throw new Error('Set POSTGRES_TEST_URL to a disposable PostgreSQL test server')
const databaseName = `review_test_${randomUUID().replaceAll('-', '')}`
const admin = createDb(testUrl, 1)
const migrationsFolder = resolve(import.meta.dir, '../packages/db/drizzle')
let db: Database
let created = false
const originalSlackUrl = process.env.SLACK_WEBHOOK_URL
const originalMeterName = process.env.STRIPE_METER_EVENT_NAME

beforeAll(async () => {
  await admin.$client.unsafe(`CREATE DATABASE "${databaseName}"`)
  created = true
  const isolatedUrl = new URL(testUrl)
  isolatedUrl.pathname = `/${databaseName}`
  db = createDb(isolatedUrl.toString(), 12)
  process.env.SLACK_WEBHOOK_URL = ''
  process.env.STRIPE_METER_EVENT_NAME = ''
  await migrate(db, { migrationsFolder })
}, 30_000)

beforeEach(async () => {
  await db.execute(sql`TRUNCATE organizations, review_reservations, rate_limits CASCADE`)
})

afterAll(async () => {
  try {
    if (db) await db.$client.end()
    if (created) await admin.$client.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`)
  } finally {
    await admin.$client.end()
    if (originalSlackUrl === undefined) delete process.env.SLACK_WEBHOOK_URL
    else process.env.SLACK_WEBHOOK_URL = originalSlackUrl
    if (originalMeterName === undefined) delete process.env.STRIPE_METER_EVENT_NAME
    else process.env.STRIPE_METER_EVENT_NAME = originalMeterName
  }
}, 30_000)

test('all migrations apply on PostgreSQL and can be run again', async () => {
  await migrate(db, { migrationsFolder })
  const rows = await db.$client<{ count: number }[]>`
    SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations
  `
  expect(rows[0].count).toBe(9)
})

test('concurrent repository activations respect the Free limit', async () => {
  for (const plan of ['free', 'team'] as const) {
    const [org] = await db.insert(schema.organizations).values({ name: plan, plan }).returning()
    const repos = await db
      .insert(schema.repositories)
      .values(
        Array.from({ length: 8 }, (_, index) => ({
          orgId: org.id,
          fullName: `${plan}/repo-${index}`,
          isActive: false,
        })),
      )
      .returning()
    const results = await Promise.all(
      repos.map((repo) =>
        db.transaction(async (tx) => {
          if (!(await canActivateRepository(tx, org.id, repo.id))) return false
          await tx
            .update(schema.repositories)
            .set({ isActive: true })
            .where(eq(schema.repositories.id, repo.id))
          return true
        }),
      ),
    )
    expect(results.filter(Boolean)).toHaveLength(plan === 'free' ? 1 : 8)
    const active = await db.query.repositories.findMany({
      where: (repo, { and, eq }) => and(eq(repo.orgId, org.id), eq(repo.isActive, true)),
    })
    expect(active).toHaveLength(plan === 'free' ? 1 : 8)
  }
})

async function stageJob(id: string, dates: { nextAttemptAt?: Date; lockedUntil?: Date } = {}) {
  await db.insert(schema.reviewReservations).values({
    reservationKey: id,
    orgKey: 'postgres-test',
    monthKey: new Date().toISOString().slice(0, 7),
  })
  await db.insert(schema.reviewDispatchOutbox).values({
    id,
    taskId: 'postgres-test',
    payload: { id },
    options: { concurrencyKey: id, idempotencyKey: id },
    ...dates,
  })
}

test('concurrent dispatchers lease each due job once and skip future or leased jobs', async () => {
  const future = new Date(Date.now() + 600_000)
  await stageJob('ready')
  await stageJob('delayed', { nextAttemptAt: future })
  await stageJob('leased', { lockedUntil: future })
  const sent: string[] = []
  const dispatch = () =>
    dispatchReviewJobs(db, async (job) => {
      sent.push(String(job.payload.id))
      await Bun.sleep(25)
    })
  await Promise.all(Array.from({ length: 8 }, dispatch))
  expect(sent).toEqual(['ready'])
  await db
    .update(schema.reviewDispatchOutbox)
    .set({ nextAttemptAt: new Date(0), lockedUntil: new Date(0) })
    .where(isNull(schema.reviewDispatchOutbox.dispatchedAt))
  await Promise.all(Array.from({ length: 8 }, dispatch))
  expect(sent.sort()).toEqual(['delayed', 'leased', 'ready'])
  const rows = await db.select().from(schema.reviewDispatchOutbox)
  expect(rows.every((row) => row.dispatchedAt instanceof Date && row.lockedUntil === null)).toBe(
    true,
  )
})

test('a failed dispatch backs off and retries with the same idempotency key', async () => {
  await stageJob('retry')
  const keys: string[] = []
  const failed = await dispatchReviewJobs(db, async (job) => {
    keys.push(job.options.idempotencyKey)
    throw new Error('Simulated queue outage')
  })
  expect(failed.dispatched).toBe(0)
  const [pending] = await db.select().from(schema.reviewDispatchOutbox)
  expect(pending.attempts).toBe(1)
  expect(pending.nextAttemptAt.getTime()).toBeGreaterThan(Date.now())
  expect(pending.lockedUntil).toBeNull()
  expect(pending.dispatchedAt).toBeNull()
  const send = async (job: { options: { idempotencyKey: string } }) => {
    keys.push(job.options.idempotencyKey)
  }
  expect((await dispatchReviewJobs(db, send)).dispatched).toBe(0)
  await db.update(schema.reviewDispatchOutbox).set({ nextAttemptAt: new Date(0) })
  expect((await dispatchReviewJobs(db, send)).dispatched).toBe(1)
  expect(keys).toEqual(['retry', 'retry'])
})

test('saving reviews counts the UTC month and persists only Team usage above 500', async () => {
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: 'Metered Team', plan: 'team', stripeCustomerId: 'cus_test_only' })
    .returning()
  const [repo] = await db
    .insert(schema.repositories)
    .values({ orgId: org.id, fullName: 'test/metered' })
    .returning()
  await db.insert(schema.reviews).values(
    Array.from({ length: 499 }, (_, index) => ({
      repoId: repo.id,
      prNumber: index + 1,
      status: 'completed' as const,
      completedAt: new Date(),
    })),
  )
  // A previous month's completion must not make the 500th review billable.
  await db.insert(schema.reviews).values({
    repoId: repo.id,
    prNumber: 1000,
    status: 'completed',
    completedAt: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1) - 1),
  })
  const save = (number: number) =>
    saveReviewAndNotify(
      {
        db,
        orgId: org.id,
        repoId: repo.id,
        provider: 'github',
        prNumber: number,
        reviewKey: `postgres-test-${number}`,
        prTitle: 'Test',
        prAuthor: null,
        reviewUrl: null,
        reviewResult: {
          summary: 'Test',
          score: 100,
          comments: [],
          tokensInput: 0,
          tokensOutput: 0,
        },
        persistedComments: [],
        commentsPosted: 0,
        bugsFound: 0,
      },
      {
        provider: 'github',
        repository: repo.fullName,
        reviewNumber: number,
        title: 'Test',
        author: null,
        reviewUrl: null,
      },
    )
  await save(500)
  expect(await db.select().from(schema.notificationOutbox)).toHaveLength(0)
  await save(501)
  await save(501)
  const rows = await db.select().from(schema.notificationOutbox)
  expect(rows).toHaveLength(1)
  expect(rows[0].kind).toBe('stripe')
  expect(rows[0].status).toBe('pending')
  expect(rows[0].payload).toMatchObject({
    customerId: 'cus_test_only',
    reviewKey: 'postgres-test-501',
  })
})
