import { expect, test } from 'bun:test'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

test('importing the database factory does not require request-bound Worker credentials', () => {
  const result = Bun.spawnSync(
    [
      process.execPath,
      '-e',
      "process.env.DATABASE_URL = ''; await import('./packages/db/src/client.ts'); console.log('loaded')",
    ],
    {
      cwd: resolve(import.meta.dir, '..'),
      env: { ...process.env, DATABASE_URL: '' },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  expect(result.exitCode).toBe(0)
  expect(result.stdout.toString()).toContain('loaded')
})

test('migration 0008 preserves paid repositories and applies the Free cap to existing data', async () => {
  const pg = new PGlite()
  const directory = resolve(import.meta.dir, '../packages/db/drizzle')
  try {
    const journal = JSON.parse(await readFile(join(directory, 'meta/_journal.json'), 'utf8'))
    for (const entry of journal.entries.filter((entry: { idx: number }) => entry.idx < 8))
      await pg.exec(await readFile(join(directory, `${entry.tag}.sql`), 'utf8'))
    await pg.exec(`INSERT INTO organizations (id, name, plan) VALUES
      ('00000000-0000-4000-8000-000000000001', 'Free', 'free'),
      ('00000000-0000-4000-8000-000000000002', 'Team', 'team');
      INSERT INTO repositories (org_id, full_name, created_at) VALUES
      ('00000000-0000-4000-8000-000000000001', 'free/oldest', '2026-01-01'),
      ('00000000-0000-4000-8000-000000000001', 'free/second', '2026-02-01'),
      ('00000000-0000-4000-8000-000000000002', 'team/first', '2026-01-01'),
      ('00000000-0000-4000-8000-000000000002', 'team/second', '2026-02-01');`)
    await pg.exec(await readFile(join(directory, '0008_grey_namorita.sql'), 'utf8'))
    const active = await pg.query<{ full_name: string }>(
      'SELECT full_name FROM repositories WHERE is_active = true ORDER BY full_name',
    )
    expect(active.rows.map((row) => row.full_name)).toEqual([
      'free/oldest',
      'team/first',
      'team/second',
    ])
    expect((await pg.query('SELECT * FROM review_dispatch_outbox')).rows).toHaveLength(0)
  } finally {
    await pg.close()
  }
}, 20_000)
