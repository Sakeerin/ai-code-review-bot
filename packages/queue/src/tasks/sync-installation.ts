import { task } from '@trigger.dev/sdk/v3'
import { createInstallationOctokit } from '@repo/github'
import {
  createDb,
  organizations,
  repositories,
  eq,
} from '@repo/db'

export interface SyncInstallationPayload {
  action: 'created' | 'deleted' | 'suspend' | 'unsuspend'
  installationId: number
  accountLogin: string
  /** Repos included in the installation event (only present on 'created') */
  repos?: Array<{ id: number; full_name: string; private: boolean }>
}

/**
 * Syncs a GitHub App installation event to the database.
 *
 * - created:   upsert organization + upsert repositories
 * - deleted:   mark organization inactive (soft-delete via plan reset)
 * - suspend/unsuspend: no-op for now (logged)
 */
export const syncInstallationTask = task({
  id: 'sync-installation',
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 1000 },
  run: async (payload: SyncInstallationPayload) => {
    const { action, installationId, accountLogin, repos } = payload
    const db = createDb()

    console.log(`🔧 sync-installation: ${action} — ${accountLogin} (id: ${installationId})`)

    switch (action) {
      case 'created': {
        // Upsert the organization record
        const existing = await db.query.organizations.findFirst({
          where: eq(organizations.githubInstallationId, String(installationId)),
        })

        let orgId: string

        if (existing) {
          orgId = existing.id
          console.log(`  Org already exists: ${orgId}`)
        } else {
          const [newOrg] = await db
            .insert(organizations)
            .values({
              githubInstallationId: String(installationId),
              name: accountLogin,
              plan: 'free',
            })
            .returning({ id: organizations.id })
          orgId = newOrg.id
          console.log(`  Created org: ${orgId}`)
        }

        // Upsert repositories included with the installation event
        if (repos && repos.length > 0) {
          for (const repo of repos) {
            const existingRepo = await db.query.repositories.findFirst({
              where: eq(repositories.githubRepoId, String(repo.id)),
            })

            if (!existingRepo) {
              await db.insert(repositories).values({
                orgId,
                githubRepoId: String(repo.id),
                fullName: repo.full_name,
                isActive: true,
              })
              console.log(`  Added repo: ${repo.full_name}`)
            }
          }
        } else {
          // If no repos in payload, fetch them from GitHub API
          try {
            const githubConfig = {
              appId: process.env.GITHUB_APP_ID!,
              privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
              webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
            }
            const octokit = await createInstallationOctokit(githubConfig, installationId)
            const { data } = await octokit.request('GET /installation/repositories', {
              per_page: 100,
            })

            for (const repo of data.repositories) {
              const existingRepo = await db.query.repositories.findFirst({
                where: eq(repositories.githubRepoId, String(repo.id)),
              })
              if (!existingRepo) {
                await db.insert(repositories).values({
                  orgId,
                  githubRepoId: String(repo.id),
                  fullName: repo.full_name,
                  isActive: true,
                })
                console.log(`  Added repo from API: ${repo.full_name}`)
              }
            }
          } catch (err) {
            console.warn('  Could not fetch repos from GitHub API:', err)
          }
        }

        break
      }

      case 'deleted': {
        // Mark all repos for this installation as inactive
        const org = await db.query.organizations.findFirst({
          where: eq(organizations.githubInstallationId, String(installationId)),
        })

        if (org) {
          await db
            .update(repositories)
            .set({ isActive: false })
            .where(eq(repositories.orgId, org.id))
          console.log(`  Deactivated repos for org ${org.id}`)
        } else {
          console.log(`  No org found for installation ${installationId}`)
        }
        break
      }

      case 'suspend':
      case 'unsuspend':
        console.log(`  No DB action needed for ${action}`)
        break
    }

    return { success: true, action, installationId }
  },
})
