import type { Database } from './client'
import { organizations, repositories } from './schema'
import { and, count, eq, ne, inArray } from 'drizzle-orm'

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

/** Every activation/auto-enrolment locks the same organization row. */
export async function canActivateRepository(tx: Transaction, orgId: string, repoId?: string) {
  const [org] = await tx
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .for('update')
  if (!org) throw new Error('Organization not found')
  if (org.plan && org.plan !== 'free') return true
  const [active] = await tx
    .select({ count: count() })
    .from(repositories)
    .where(
      and(
        eq(repositories.orgId, orgId),
        eq(repositories.isActive, true),
        repoId ? ne(repositories.id, repoId) : undefined,
      ),
    )
  return active.count < 1
}

/** Called while the billing transaction owns the organization lock. */
export async function enforceFreeRepositoryLimit(tx: Transaction, orgId: string) {
  const extra = await tx
    .select({ id: repositories.id })
    .from(repositories)
    .where(and(eq(repositories.orgId, orgId), eq(repositories.isActive, true)))
    .orderBy(repositories.createdAt, repositories.id)
    .offset(1)
  if (extra.length)
    await tx
      .update(repositories)
      .set({ isActive: false })
      .where(
        inArray(
          repositories.id,
          extra.map((row) => row.id),
        ),
      )
}
