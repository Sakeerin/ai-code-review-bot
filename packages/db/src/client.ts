import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

/**
 * Create a database client.
 *
 * Pool sizing guidance:
 * - Next.js (persistent server): default max=5 is fine; override via DB_POOL_MAX
 * - Trigger.dev tasks (serverless): pass max=2 to avoid exhausting Supabase limits
 *   when many concurrent tasks run. Each task invocation creates its own pool.
 */
export function createDb(databaseUrl?: string, poolSize?: number) {
  const url = databaseUrl ?? process.env['DATABASE_URL']
  if (!url) {
    throw new Error('DATABASE_URL environment variable is required')
  }

  const max = poolSize ?? parseInt(process.env['DB_POOL_MAX'] ?? '5', 10)

  const client = postgres(url, {
    max,
    idle_timeout: 20,
    connect_timeout: 10,
  })

  return drizzle(client, { schema })
}

export type Database = ReturnType<typeof createDb>

// Singleton instance — used by Next.js server components and API routes
export const db = createDb()
