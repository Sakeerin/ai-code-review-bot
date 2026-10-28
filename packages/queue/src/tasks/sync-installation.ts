import { task } from '@trigger.dev/sdk/v3'
import { createInstallationOctokit } from '@repo/github'
import { createDb, organizations, repositories, eq } from '@repo/db'
import { findGitHubRepo } from '../lib/repository.js'

export interface SyncInstallationPayload {
  action: 'created' | 'deleted' | 'suspend' | 'unsuspend'
  installationId: number
  accountLogin: string
  repos?: Array<{ id: number; full_name: string; private: boolean }>
}

export const syncInstallationTask = task({
  id: 'sync-installation',
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 1000 },
  run: async ({ action, installationId, accountLogin, repos }: SyncInstallationPayload) => {
    const db = createDb(undefined, 2)
    if (action === 'created') {
      await db
        .insert(organizations)
        .values({ githubInstallationId: String(installationId), name: accountLogin })
        .onConflictDoUpdate({
          target: organizations.githubInstallationId,
          set: { name: accountLogin },
        })
      if (repos) {
        for (const repo of repos) await findGitHubRepo(db, installationId, repo.full_name, repo.id)
      } else {
        const octokit = await createInstallationOctokit(
          {
            appId: process.env.GITHUB_APP_ID!,
            privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
            webhookSecret: '',
          },
          installationId,
        )
        for (let page = 1; ; page++) {
          if (page > 1000) throw new Error('Installation repository pagination limit exceeded')
          const { data } = await octokit.request('GET /installation/repositories', {
            per_page: 100,
            page,
          })
          for (const repo of data.repositories)
            await findGitHubRepo(db, installationId, repo.full_name, repo.id)
          if (data.repositories.length < 100) break
        }
      }
    } else if (action === 'deleted' || action === 'suspend') {
      const org = await db.query.organizations.findFirst({
        where: eq(organizations.githubInstallationId, String(installationId)),
      })
      if (org)
        await db.update(repositories).set({ isActive: false }).where(eq(repositories.orgId, org.id))
    }
    // Unsuspension requires an administrator to choose which repositories to enable.
    return { success: true, action, installationId }
  },
})
