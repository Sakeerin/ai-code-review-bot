import { createAppAuth } from '@octokit/auth-app'
import { Octokit } from 'octokit'
import type { GitHubAppConfig } from './types.js'

/**
 * Creates an authenticated Octokit instance for a GitHub App installation.
 */
export function createAppOctokit(config: GitHubAppConfig): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: config.appId,
      privateKey: config.privateKey,
    },
  })
}

/**
 * Creates an Octokit instance authenticated as a specific installation.
 * This is what you use to make API calls on behalf of a repository.
 */
export async function createInstallationOctokit(
  config: GitHubAppConfig,
  installationId: number,
): Promise<Octokit> {
  const appOctokit = createAppOctokit(config)

  const { data: installation } =
    await appOctokit.rest.apps.createInstallationAccessToken({
      installation_id: installationId,
    })

  return new Octokit({
    auth: installation.token,
  })
}
