import { type Database, organizations, repositories, and, eq } from '@repo/db'
import { canActivateRepository } from '@repo/db/repository-policy'
import { createInstallationOctokit } from '@repo/github'

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
  if (existing && existing.fullName === fullName) return existing
  if (!githubRepoId) throw new Error('GitHub repository has not been synchronized yet')
  // Installation-scoped credentials must confirm the current repository owner.
  // Signed but delayed webhook payloads alone cannot move a tenant's data.
  const octokit = await createInstallationOctokit(
    {
      appId: process.env.GITHUB_APP_ID!,
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
      webhookSecret: '',
    },
    installationId,
  )
  const [owner, repoName] = fullName.split('/')
  const { data: remote } = await octokit.rest.repos.get({ owner, repo: repoName })
  if (remote.id !== githubRepoId || remote.full_name !== fullName)
    throw new Error('GitHub repository installation mismatch')
  return db.transaction(async (tx) => {
    const active = await canActivateRepository(tx, org.id, existing?.id)
    const [previous] = await tx
      .select()
      .from(repositories)
      .where(eq(repositories.githubRepoId, String(githubRepoId)))
      .for('update')
    if (previous?.orgId === org.id) {
      const [updated] = await tx
        .update(repositories)
        .set({ fullName, webUrl: remote.html_url })
        .where(eq(repositories.id, previous.id))
        .returning()
      return updated
    }
    if (previous)
      await tx
        .update(repositories)
        .set({ githubRepoId: null, isActive: false })
        .where(eq(repositories.id, previous.id))
    // Keep historical reviews and private conventions with the previous tenant.
    const [created] = await tx
      .insert(repositories)
      .values({
        orgId: org.id,
        provider: 'github',
        githubRepoId: String(githubRepoId),
        fullName,
        webUrl: remote.html_url,
        isActive: active,
      })
      .returning()
    return created
  })
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
  return db.transaction(async (tx) => {
    const active = await canActivateRepository(tx, org.id)
    const [repo] = await tx
      .insert(repositories)
      .values({
        orgId: org.id,
        provider: 'bitbucket',
        bitbucketRepoId: fullName,
        fullName,
        webUrl: `https://bitbucket.org/${fullName}`,
        isActive: active,
      })
      .onConflictDoUpdate({
        target: repositories.bitbucketRepoId,
        set: { orgId: org.id, fullName },
      })
      .returning()
    return repo
  })
}
