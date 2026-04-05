import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

/**
 * Create a database client connected to Supabase/PostgreSQL.
 * Uses DATABASE_URL env var.
 */
export function createDb(databaseUrl?: string) {
  const url = databaseUrl ?? process.env['DATABASE_URL']
  if (!url) {
    throw new Error('DATABASE_URL environment variable is required')
  }

  const client = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  })

  return drizzle(client, { schema })
}

export type Database = ReturnType<typeof createDb>
