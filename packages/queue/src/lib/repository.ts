import { type Database, organizations, repositories, and, eq } from '@repo/db'

export async function findGitHubRepo(
  db: Database,
  installationId: number,
  fullName: string,
  githubRepoId?: number,
) {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.githubInstallationId, String(installationId)),
  })
  if (!org) throw new Error('GitHub installation has not been synchronized yet')
  const existing = await db.query.repositories.findFirst({
    where: and(
      eq(repositories.provider, 'github'),
      eq(repositories.orgId, org.id),
      githubRepoId
        ? eq(repositories.githubRepoId, String(githubRepoId))
        : eq(repositories.fullName, fullName),
    ),
  })
  if (existing) return existing
  if (!githubRepoId) throw new Error('GitHub repository has not been synchronized yet')
  const [repo] = await db
    .insert(repositories)
    .values({
      orgId: org.id,
      provider: 'github',
      githubRepoId: String(githubRepoId),
      fullName,
    })
    .onConflictDoNothing()
    .returning()
  if (repo) return repo
  // A conflicting ID belonging to another installation must never select that tenant's row.
  const concurrent = await db.query.repositories.findFirst({
    where: and(
      eq(repositories.provider, 'github'),
      eq(repositories.orgId, org.id),
      eq(repositories.githubRepoId, String(githubRepoId)),
    ),
  })
  if (!concurrent) throw new Error('GitHub repository installation mismatch')
  return concurrent
}

export async function upsertBitbucketRepo(db: Database, workspace: string, fullName: string) {
  const [org] = await db
    .insert(organizations)
    .values({
      name: workspace,
      bitbucketWorkspace: workspace,
      plan: 'free',
    })
    .onConflictDoUpdate({ target: organizations.bitbucketWorkspace, set: { name: workspace } })
    .returning()
  const [repo] = await db
    .insert(repositories)
    .values({
      orgId: org.id,
      provider: 'bitbucket',
      bitbucketRepoId: fullName,
      fullName,
      webUrl: `https://bitbucket.org/${fullName}`,
    })
    .onConflictDoUpdate({
      target: repositories.bitbucketRepoId,
      set: { orgId: org.id, fullName },
    })
    .returning()
  return repo
}
